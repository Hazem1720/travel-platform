import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  buildSort,
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import {
  HotelAvailabilityService,
  stayNights,
} from '../hotel-bookings/hotel-availability.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  RoomLock,
  RoomLockDocument,
  RoomLockKind,
} from '../hotel-bookings/schemas/room-lock.schema';
import { AvailabilityRangeDto } from './dto/availability-range.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import {
  HotelCalendarQueryDto,
  MAX_CALENDAR_NIGHTS,
  RoomNightStatus,
  UpdateRoomAvailabilityDto,
} from './dto/room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { HOTEL_NOT_FOUND } from './hotels.service';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { BookableRange, Room, RoomDocument } from './schemas/room.schema';

export const ROOM_NOT_FOUND = 'Room not found';
export const RANGE_OVERLAP =
  'This range overlaps a bookable range the room already has';
export const RANGES_OVERLAP = 'Two of the given ranges overlap';
export const ONE_AVAILABILITY_ACTION =
  'Send exactly one of ranges, block or unblock';
export const RESERVED_NIGHTS_NOT_COVERED =
  'Availability cannot be removed for nights with a Confirmed or PendingPayment reservation';
export const ROOM_HAS_RESERVATIONS =
  'This room has a Confirmed or PendingPayment reservation on a future night';
export const ROOM_WAS_RESERVED =
  'Only rooms that have never been reserved can be deleted; deactivate it instead';
export const BLOCK_CONFLICT =
  'Some of these nights are held, booked or already blocked; nothing was blocked';
export const ROOM_CHANGED =
  'The room was changed at the same time, please try again';

const HOUR_MS = 60 * 60 * 1000;

// The earliest calendar date anywhere on Earth right now (UTC-12). Nights
// from this date on are "future" for every hotel, whatever its time zone, so
// a night that has not started yet in the hotel's city is never missed.
export function earliestToday(now = new Date()): string {
  return new Date(now.getTime() - 12 * HOUR_MS).toISOString().slice(0, 10);
}

function validationError(field: string, message: string) {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

function assertRangeOrder(range: AvailabilityRangeDto, field: string) {
  if (range.to <= range.from) {
    throw validationError(`${field}.to`, 'to must be after from');
  }
}

// HTL-05: checks a full list of bookable ranges and returns it sorted by
// `from`. Each range needs `to` after `from`; ranges may touch (one ends the
// day the next starts) but never overlap (400), the HTL-04 rule.
export function normalizeRanges(
  ranges: AvailabilityRangeDto[],
): BookableRange[] {
  ranges.forEach((r, i) => assertRangeOrder(r, `ranges.${i}`));
  const sorted = ranges
    .map((r) => ({ from: r.from, to: r.to }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) {
      throw new BadRequestException(RANGES_OVERLAP);
    }
  }
  return sorted;
}

// True if the night ("YYYY-MM-DD") is inside one of the ranges.
export function inRanges(ranges: BookableRange[], night: string): boolean {
  return ranges.some((r) => r.from <= night && night < r.to);
}

// A lock that stands for a reservation: Booked (Confirmed) or a Held night
// whose 10-minute hold has not run out (PendingPayment).
function reservationLock(now = new Date()) {
  return {
    $or: [
      { kind: RoomLockKind.BOOKED },
      { kind: RoomLockKind.HELD, expiresAt: { $gt: now } },
    ],
  };
}

export interface RoomNight {
  date: string;
  status: RoomNightStatus;
  reference?: string | null;
  bookingId?: string;
  bookingStatus?: string;
}

export interface RoomCalendar {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  nights: RoomNight[];
}

export interface HotelCalendar extends PaginatedResult<RoomCalendar> {
  hotelId: string;
  from: string;
  to: string;
}

// HTL-03 (add a room), HTL-04 (bookable date ranges), HTL-05 (edit a room and
// its ranges), HTL-06 (block dates, deactivate, delete) and HTL-08 (the
// hotel's room calendar). Room nights are taken through Memo's RoomLock
// documents (HTL-11): one per room per night, unique on (roomId, date).
@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomLock.name)
    private readonly locks: Model<RoomLockDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    private readonly availability: HotelAvailabilityService,
  ) {}

  // The name must be unique within the hotel. That rule is the unique index
  // on (hotelId, name): a duplicate is a duplicate-key error, which the global
  // filter turns into 409, even when two requests arrive at the same moment.
  async create(hotelId: string, dto: CreateRoomDto) {
    if (!(await this.hotels.exists({ _id: hotelId }))) {
      throw new NotFoundException(HOTEL_NOT_FOUND);
    }
    const room = await this.rooms.create({ ...dto, hotelId });
    return room.toObject();
  }

  // HTL-04. `to` must be after `from`; the new range may touch an existing
  // range (one ends the day the next starts) but not overlap it. The overlap
  // check and the insert are ONE conditional update, so two requests that add
  // overlapping ranges at the same moment cannot both succeed.
  async addAvailability(
    hotelId: string,
    roomId: string,
    dto: AvailabilityRangeDto,
  ) {
    if (dto.to <= dto.from) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { to: ['to must be after from'] },
      });
    }
    const updated = await this.rooms
      .findOneAndUpdate(
        {
          _id: roomId,
          hotelId,
          // No existing range [a, b) with a < to and b > from.
          bookableRanges: {
            $not: {
              $elemMatch: { from: { $lt: dto.to }, to: { $gt: dto.from } },
            },
          },
        },
        {
          $push: {
            bookableRanges: {
              $each: [{ from: dto.from, to: dto.to }],
              $sort: { from: 1 },
            },
          },
        },
        { new: true },
      )
      .lean();
    if (updated) return updated;

    // Nothing was updated: either the room is not in this hotel, or the range
    // overlaps. Look once to tell them apart.
    const room = await this.rooms.findOne({ _id: roomId, hotelId }).lean();
    if (!room) throw new NotFoundException(ROOM_NOT_FOUND);
    throw new BadRequestException(RANGE_OVERLAP);
  }

  // HTL-05 (beds, maxOccupancy, pricePerNight) and HTL-06 (isActive).
  // A price change never touches reservations: each one keeps the price
  // snapshot taken at booking time (HotelBooking.rooms[].pricePerNight).
  // Deactivating is refused (409) while a Confirmed or PendingPayment
  // reservation covers a future night. The check runs before the update and
  // again after it: a hold that slipped in between is caught by the second
  // check and the room is put back as it was.
  async update(hotelId: string, roomId: string, dto: UpdateRoomDto) {
    const before = await this.rooms.findOne({ _id: roomId, hotelId }).lean();
    if (!before) throw new NotFoundException(ROOM_NOT_FOUND);

    const deactivating = dto.isActive === false && before.isActive;
    if (deactivating && (await this.hasFutureReservation(roomId))) {
      throw new ConflictException(ROOM_HAS_RESERVATIONS);
    }
    const updated = await this.rooms
      .findOneAndUpdate(
        { _id: roomId, hotelId },
        { $set: dto },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) throw new NotFoundException(ROOM_NOT_FOUND);

    if (deactivating && (await this.hasFutureReservation(roomId))) {
      const restore: Record<string, unknown> = {};
      for (const key of Object.keys(dto) as (keyof UpdateRoomDto)[]) {
        restore[key] = before[key];
      }
      await this.rooms.updateOne({ _id: roomId, hotelId }, { $set: restore });
      throw new ConflictException(ROOM_HAS_RESERVATIONS);
    }
    return updated;
  }

  // PATCH .../availability: exactly one of ranges (HTL-05), block or unblock
  // (HTL-06).
  async updateAvailability(
    hotelId: string,
    roomId: string,
    dto: UpdateRoomAvailabilityDto,
  ) {
    const given = (['ranges', 'block', 'unblock'] as const).filter(
      (key) => dto[key] !== undefined,
    );
    if (given.length !== 1) {
      throw new BadRequestException(ONE_AVAILABILITY_ACTION);
    }
    if (dto.ranges) return this.replaceRanges(hotelId, roomId, dto.ranges);
    if (dto.block) return this.block(hotelId, roomId, dto.block);
    return this.unblock(hotelId, roomId, dto.unblock!);
  }

  // HTL-05: replaces the room's bookable ranges. Refused (409, with the
  // nights) if a future night with a Confirmed or PendingPayment reservation
  // would no longer be covered. The write only succeeds if the room was not
  // changed since it was read (updatedAt), and the reservations are checked
  // again afterwards, so a hold placed in between is never left outside the
  // ranges: the old ranges are put back and the request is refused.
  private async replaceRanges(
    hotelId: string,
    roomId: string,
    input: AvailabilityRangeDto[],
  ) {
    const ranges = normalizeRanges(input);
    const room = await this.rooms.findOne({ _id: roomId, hotelId }).lean();
    if (!room) throw new NotFoundException(ROOM_NOT_FOUND);

    const lost = await this.reservedNightsOutside(roomId, ranges);
    if (lost.length) throw this.reservedNightsConflict(lost);

    const updatedAt = (room as { updatedAt?: Date }).updatedAt;
    const updated = await this.rooms
      .findOneAndUpdate(
        { _id: roomId, hotelId, ...(updatedAt ? { updatedAt } : {}) },
        { $set: { bookableRanges: ranges } },
        { new: true },
      )
      .lean();
    if (!updated) throw new ConflictException(ROOM_CHANGED);

    const lostAfter = await this.reservedNightsOutside(roomId, ranges);
    if (lostAfter.length) {
      await this.rooms.updateOne(
        { _id: roomId, hotelId },
        { $set: { bookableRanges: room.bookableRanges } },
      );
      throw this.reservedNightsConflict(lostAfter);
    }
    return updated;
  }

  // HTL-06: blocks every night in [from, to) with Blocked RoomLocks, all or
  // nothing (Memo's lockNights: on a duplicate key it deletes what it
  // inserted). So blocking over a held, booked or already blocked night is
  // refused with 409 and nothing is blocked.
  private async block(
    hotelId: string,
    roomId: string,
    range: AvailabilityRangeDto,
  ) {
    assertRangeOrder(range, 'block');
    let nights: number;
    try {
      nights = await this.availability.lockNights({
        hotelId,
        roomIds: [roomId],
        checkIn: range.from,
        checkOut: range.to,
        kind: RoomLockKind.BLOCKED,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        throw new ConflictException(BLOCK_CONFLICT);
      }
      throw err;
    }
    return { roomId, from: range.from, to: range.to, nights };
  }

  // HTL-06: removes the room's Blocked nights in [from, to). Held and Booked
  // nights are never touched. Nights that were not blocked are ignored.
  private async unblock(
    hotelId: string,
    roomId: string,
    range: AvailabilityRangeDto,
  ) {
    assertRangeOrder(range, 'unblock');
    if (!(await this.rooms.exists({ _id: roomId, hotelId }))) {
      throw new NotFoundException(ROOM_NOT_FOUND);
    }
    const nights = await this.availability.unblock(
      roomId,
      range.from,
      range.to,
    );
    return { roomId, from: range.from, to: range.to, nights };
  }

  // HTL-06: deletes a room that has never been reserved (no reservation
  // other than an expired hold, and no Held or Booked night). The room is
  // first made inactive so no new hold can start on it during the check
  // (search and holds only use active rooms); if it was reserved, it is
  // reactivated and the request is refused with 409. Its Blocked nights are
  // deleted with it.
  async remove(hotelId: string, roomId: string) {
    const room = await this.rooms.findOne({ _id: roomId, hotelId }).lean();
    if (!room) throw new NotFoundException(ROOM_NOT_FOUND);

    await this.rooms.updateOne(
      { _id: roomId, hotelId },
      { $set: { isActive: false } },
    );
    if (await this.wasReserved(roomId)) {
      if (room.isActive) {
        await this.rooms.updateOne(
          { _id: roomId, hotelId },
          { $set: { isActive: true } },
        );
      }
      throw new ConflictException(ROOM_WAS_RESERVED);
    }
    await this.rooms.deleteOne({ _id: roomId, hotelId });
    await this.locks.deleteMany({ roomId });
    return { id: roomId, deleted: true };
  }

  // HTL-08: every room of the hotel (10 per page, by name) with the status of
  // each night in [from, to): Booked (with the reservation reference; a hold
  // that is still running shows as Booked with bookingStatus PendingPayment
  // and no reference yet), Blocked, Available, or Unavailable (outside every
  // bookable range, or the room is deactivated). At most 31 nights.
  async calendar(
    hotelId: string,
    q: HotelCalendarQueryDto,
  ): Promise<HotelCalendar> {
    if (q.to <= q.from) throw validationError('to', 'to must be after from');
    const nights = stayNights(q.from, q.to);
    if (nights.length > MAX_CALENDAR_NIGHTS) {
      throw validationError(
        'to',
        `At most ${MAX_CALENDAR_NIGHTS} nights can be shown at once`,
      );
    }
    if (!(await this.hotels.exists({ _id: hotelId }))) {
      throw new NotFoundException(HOTEL_NOT_FOUND);
    }

    const { page, limit } = q;
    const filter = { hotelId };
    const [rooms, total] = await Promise.all([
      this.rooms
        .find(filter)
        .sort(buildSort(q.sort, ['name', 'type', 'pricePerNight'], 'name:asc'))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.rooms.countDocuments(filter),
    ]);

    const now = new Date();
    const locks = rooms.length
      ? await this.locks
          .find({
            roomId: { $in: rooms.map((r) => r._id) },
            date: { $gte: q.from, $lt: q.to },
          })
          .lean()
      : [];
    // An expired hold no longer takes the night (HTL-11).
    const live = locks.filter(
      (l) =>
        l.kind !== RoomLockKind.HELD ||
        (l.expiresAt !== null && new Date(l.expiresAt) > now),
    );
    const lockAt = new Map(
      live.map((l) => [`${String(l.roomId)}|${l.date}`, l]),
    );

    const bookingIds = [
      ...new Set(
        live.filter((l) => l.bookingId).map((l) => String(l.bookingId)),
      ),
    ];
    const bookings = bookingIds.length
      ? await this.bookings
          .find({ _id: { $in: bookingIds } }, { reference: 1, status: 1 })
          .lean()
      : [];
    const bookingById = new Map(bookings.map((b) => [String(b._id), b]));

    const data: RoomCalendar[] = rooms.map((room) => ({
      id: String(room._id),
      name: room.name,
      type: room.type,
      isActive: room.isActive,
      nights: nights.map((date): RoomNight => {
        const lock = lockAt.get(`${String(room._id)}|${date}`);
        if (lock?.kind === RoomLockKind.BLOCKED) {
          return { date, status: RoomNightStatus.BLOCKED };
        }
        if (lock) {
          const booking = bookingById.get(String(lock.bookingId));
          return {
            date,
            status: RoomNightStatus.BOOKED,
            reference: booking?.reference ?? null,
            bookingId: String(lock.bookingId),
            bookingStatus:
              booking?.status ??
              (lock.kind === RoomLockKind.BOOKED
                ? BookingStatus.CONFIRMED
                : BookingStatus.PENDING_PAYMENT),
          };
        }
        if (!room.isActive || !inRanges(room.bookableRanges, date)) {
          return { date, status: RoomNightStatus.UNAVAILABLE };
        }
        return { date, status: RoomNightStatus.AVAILABLE };
      }),
    }));

    return {
      hotelId,
      from: q.from,
      to: q.to,
      ...paginated(data, total, page, limit),
    };
  }

  // A Confirmed or unexpired PendingPayment night from today on.
  private async hasFutureReservation(roomId: string): Promise<boolean> {
    const found = await this.locks.exists({
      roomId,
      date: { $gte: earliestToday() },
      ...reservationLock(),
    });
    return Boolean(found);
  }

  // The future reserved nights of a room that the given ranges do not cover.
  private async reservedNightsOutside(
    roomId: string,
    ranges: BookableRange[],
  ): Promise<string[]> {
    const taken = await this.locks
      .find(
        { roomId, date: { $gte: earliestToday() }, ...reservationLock() },
        { date: 1 },
      )
      .lean();
    return [...new Set(taken.map((l) => l.date))]
      .filter((date) => !inRanges(ranges, date))
      .sort();
  }

  private reservedNightsConflict(nights: string[]) {
    return new ConflictException({
      error: 'Conflict',
      message: RESERVED_NIGHTS_NOT_COVERED,
      details: { nights },
    });
  }

  // Ever reserved: a reservation for this room that did not just expire as
  // an unpaid hold, or a Held or Booked night still on the room.
  private async wasReserved(roomId: string): Promise<boolean> {
    const [booking, lock] = await Promise.all([
      this.bookings.exists({
        'rooms.roomId': roomId,
        status: { $ne: BookingStatus.EXPIRED },
      }),
      this.locks.exists({
        roomId,
        kind: { $in: [RoomLockKind.HELD, RoomLockKind.BOOKED] },
      }),
    ]);
    return Boolean(booking || lock);
  }
}
