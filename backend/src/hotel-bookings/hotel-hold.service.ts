import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  assertTransition,
  BookingStatus,
} from '../common/enums/booking-status.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { Room, RoomDocument } from '../hotels/schemas/room.schema';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import {
  HotelAvailabilityService,
  ROOM_NOT_FOUND,
  ROOMS_NOT_AVAILABLE,
  stayNights,
} from './hotel-availability.service';
import {
  assertRoomSelection,
  assertRoomsFit,
  holdExpiry,
  priceRooms,
  RoomForBooking,
} from './hotel-booking.rules';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import { badRequest, HotelSearchService } from './hotel-search.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { RoomLockKind } from './schemas/room-lock.schema';

export type LeanHotelBooking = HotelBooking & { _id: Types.ObjectId };

// What every hotel-booking route returns: ids as strings, nothing internal.
export function toHotelBookingView(b: LeanHotelBooking) {
  return {
    _id: String(b._id),
    status: b.status,
    reference: b.reference ?? null,
    hotelId: String(b.hotelId),
    hotelName: b.hotelName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    rooms: b.rooms.map((r) => ({
      roomId: String(r.roomId),
      name: r.name,
      type: r.type,
      adults: r.adults,
      childAges: r.childAges ?? [],
      pricePerNight: r.pricePerNight,
      subtotal: r.subtotal,
    })),
    totalAmount: b.totalAmount,
    currency: b.currency,
    expiresAt: b.expiresAt ?? null,
    policiesAcceptedAt: b.policiesAcceptedAt ?? null,
    createdAt: b.createdAt,
  };
}
export type HotelBookingView = ReturnType<typeof toHotelBookingView>;

// HTL-16 (book one or more rooms) and HTL-18 (hold them for 10 minutes).
// There is no draft: the booking request is the hold, and the reservation
// starts as PendingPayment.
@Injectable()
export class HotelHoldService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    private readonly availability: HotelAvailabilityService,
    private readonly search: HotelSearchService,
  ) {}

  // Checks first (400 / 404 / 409), then the hold, then the reservation:
  // 1. dates (checkOut after checkIn, checkIn not in the past in the
  //    hotel's city), rooms listed once, a guest in every room, one adult;
  // 2. an active hotel (404), every room known (404), in that hotel (400)
  //    and not over its maxOccupancy (400);
  // 3. every room free for every night (409), then all their nights locked
  //    together with one ordered insert (lockNights): if another request
  //    took any of them first, nothing is held (409);
  // 4. the PendingPayment reservation, with the price snapshot and
  //    expiresAt = now + 10 minutes. If saving it fails, the locks go.
  async hold(
    user: AuthUser,
    dto: CreateHotelBookingDto,
  ): Promise<HotelBookingView> {
    const nights = stayNights(dto.checkIn, dto.checkOut).length;
    assertRoomSelection(dto.rooms);

    const hotel = await this.hotels.findById(dto.hotelId).lean();
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException(HOTEL_NOT_FOUND);
    }
    if (dto.checkIn < (await this.search.today({ cityId: hotel.cityId }))) {
      throw badRequest('checkIn', 'checkIn cannot be in the past');
    }

    const roomIds = dto.rooms.map((r) => r.roomId);
    const docs = await this.rooms
      .find(
        { _id: { $in: roomIds } },
        { hotelId: 1, name: 1, type: 1, maxOccupancy: 1, pricePerNight: 1 },
      )
      .lean<RoomForBooking[]>();
    const found = new Map(docs.map((r) => [String(r._id), r]));
    if (found.size !== roomIds.length) {
      throw new NotFoundException(ROOM_NOT_FOUND);
    }
    assertRoomsFit(dto.hotelId, dto.rooms, found);

    // Active, bookable on every night and not locked (HTL-11's rule). An
    // early, friendly 409; lockNights below is what makes it safe.
    const free = await this.availability.freeRooms(
      String(hotel._id),
      dto.checkIn,
      dto.checkOut,
    );
    const freeIds = new Set(free.map((r) => String(r._id)));
    if (roomIds.some((id) => !freeIds.has(id))) {
      throw new ConflictException(ROOMS_NOT_AVAILABLE);
    }

    const priced = priceRooms(dto.rooms, found, nights);
    const bookingId = new Types.ObjectId();
    const expiresAt = holdExpiry();
    await this.availability.lockNights({
      hotelId: String(hotel._id),
      roomIds,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      kind: RoomLockKind.HELD,
      bookingId: String(bookingId),
      expiresAt,
    });

    try {
      const created = await this.bookings.create({
        _id: bookingId,
        userId: new Types.ObjectId(user.id),
        hotelId: hotel._id,
        hotelName: hotel.name,
        status: BookingStatus.PENDING_PAYMENT,
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        nights,
        rooms: priced.rooms,
        totalAmount: priced.totalAmount,
        expiresAt,
      });
      return toHotelBookingView(created.toObject() as LeanHotelBooking);
    } catch (err) {
      await this.availability.releaseBooking(String(bookingId));
      throw err;
    }
  }

  // HTL-18: the hold ran out. PendingPayment to Expired and every night of
  // the reservation freed. Safe to call twice: an Expired reservation is
  // left alone, and the status is in the update filter, so a payment
  // confirming at the same moment and this expiry cannot both win.
  // 409 (assertTransition) for a reservation that is Confirmed or later.
  async expire(bookingId: string, now = new Date()): Promise<void> {
    if (!isValidObjectId(bookingId)) return;
    const booking = await this.bookings
      .findById(bookingId, { status: 1 })
      .lean<Pick<LeanHotelBooking, '_id' | 'status'>>();
    if (!booking || booking.status === BookingStatus.EXPIRED) return;
    assertTransition(booking.status, BookingStatus.EXPIRED);
    const res = await this.bookings.updateOne(
      { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
      { $set: { status: BookingStatus.EXPIRED, expiredAt: now } },
    );
    if (res.modifiedCount === 0) return;
    await this.availability.releaseBooking(String(booking._id));
  }

  // PendingPayment reservations whose hold has run out (the expiry job).
  async findExpiredHolds(now = new Date()): Promise<string[]> {
    const due = await this.bookings
      .find(
        { status: BookingStatus.PENDING_PAYMENT, expiresAt: { $lte: now } },
        { _id: 1 },
      )
      .lean<{ _id: Types.ObjectId }[]>();
    return due.map((b) => String(b._id));
  }
}
