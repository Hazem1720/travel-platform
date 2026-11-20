import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDateOnly } from '../hotels/dto/date-only';
import {
  BookableRange,
  Room,
  RoomDocument,
} from '../hotels/schemas/room.schema';
import {
  RoomLock,
  RoomLockDocument,
  RoomLockKind,
} from './schemas/room-lock.schema';

export const ROOMS_NOT_AVAILABLE =
  'One or more rooms are not available for these dates';
export const ROOM_NOT_FOUND = 'Room not found';
// Longest stay or block handled in one call, so one request can never create
// thousands of lock documents.
export const MAX_STAY_NIGHTS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

function dateError(field: string, message: string) {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// The nights of a stay, as "YYYY-MM-DD": from checkIn up to, but not
// including, checkOut (the HTL-04 range format). 400 if a date is not a real
// date, checkOut is not after checkIn, or the stay is longer than
// MAX_STAY_NIGHTS. Whether checkIn is in the past is the caller's rule
// (HTL-11, HTL-18), because HTL-08 and HTL-06 may look at past nights.
export function stayNights(checkIn: string, checkOut: string): string[] {
  if (!isDateOnly(checkIn)) {
    throw dateError(
      'checkIn',
      'checkIn must be a real date written as YYYY-MM-DD',
    );
  }
  if (!isDateOnly(checkOut)) {
    throw dateError(
      'checkOut',
      'checkOut must be a real date written as YYYY-MM-DD',
    );
  }
  if (checkOut <= checkIn) {
    throw dateError('checkOut', 'checkOut must be after checkIn');
  }
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const count = Math.round(
    (Date.parse(`${checkOut}T00:00:00Z`) - start) / DAY_MS,
  );
  if (count > MAX_STAY_NIGHTS) {
    throw dateError(
      'checkOut',
      `A stay can be at most ${MAX_STAY_NIGHTS} nights`,
    );
  }
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

// True if every night from checkIn to checkOut is inside one of the room's
// bookable ranges. Ranges may touch, so a stay can run across two of them.
export function coversStay(
  ranges: BookableRange[],
  checkIn: string,
  checkOut: string,
): boolean {
  let night = checkIn;
  while (night < checkOut) {
    const range = ranges.find((r) => r.from <= night && night < r.to);
    if (!range) return false;
    night = range.to;
  }
  return true;
}

export type FreeRoom = Room & { _id: Types.ObjectId };

export interface LockNightsInput {
  hotelId: string;
  roomIds: string[];
  checkIn: string;
  checkOut: string;
  kind: RoomLockKind;
  // Required for Held and Booked, absent for Blocked.
  bookingId?: string;
  // Required for Held: the end of the 10-minute hold.
  expiresAt?: Date;
}

// HTL-11: which rooms are free, and the room-night locks behind holds (HTL-18),
// confirmed reservations (HTL-17) and blocked dates (HTL-06). Exported by
// HotelBookingsModule for Rawda (HTL-02, HTL-05, HTL-06, HTL-08), Moharm
// (ITN-25) and Memo's own search, rooms list and booking routes.
@Injectable()
export class HotelAvailabilityService {
  constructor(
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomLock.name)
    private readonly locks: Model<RoomLockDocument>,
  ) {}

  // The rooms of one hotel that are free for the whole stay: active, every
  // night inside a bookable range, and no lock on any night (a Held lock whose
  // expiresAt has passed counts as free). Cheapest first. It does not check
  // the hotel itself: callers answer 404 for an inactive hotel.
  async freeRooms(
    hotelId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<FreeRoom[]> {
    const byHotel = await this.freeRoomsByHotel([hotelId], checkIn, checkOut);
    return byHotel.get(String(hotelId)) ?? [];
  }

  // The same for many hotels in two queries (HTL-11 search), keyed by the
  // hotel id as a string. Hotels with no free room are left out.
  async freeRoomsByHotel(
    hotelIds: string[],
    checkIn: string,
    checkOut: string,
  ): Promise<Map<string, FreeRoom[]>> {
    stayNights(checkIn, checkOut);
    const result = new Map<string, FreeRoom[]>();
    if (!hotelIds.length) return result;

    const candidates = (await this.rooms
      .find({
        hotelId: { $in: hotelIds },
        isActive: true,
        // Narrows to rooms bookable on the first night; coversStay checks
        // the rest.
        bookableRanges: {
          $elemMatch: { from: { $lte: checkIn }, to: { $gt: checkIn } },
        },
      })
      .sort({ pricePerNight: 1, name: 1 })
      .lean()) as FreeRoom[];
    const bookable = candidates.filter((room) =>
      coversStay(room.bookableRanges, checkIn, checkOut),
    );
    if (!bookable.length) return result;

    const taken = await this.locks.distinct('roomId', {
      roomId: { $in: bookable.map((room) => room._id) },
      date: { $gte: checkIn, $lt: checkOut },
      $or: [
        { kind: { $ne: RoomLockKind.HELD } },
        { expiresAt: { $gt: new Date() } },
      ],
    });
    const takenIds = new Set(taken.map(String));

    for (const room of bookable) {
      if (takenIds.has(String(room._id))) continue;
      const key = String(room.hotelId);
      result.set(key, [...(result.get(key) ?? []), room]);
    }
    return result;
  }

  // Takes every night of the stay for every room, all or nothing
  // (conventions.md, "Overlap safety"): one ordered insert, and if any room
  // night is already locked (duplicate key), the locks this call inserted are
  // deleted and the whole request is refused with 409. Expired holds on those
  // nights are cleared first, so they never block. It only checks overlap:
  // callers check bookable ranges and isActive with freeRooms first (HTL-18).
  // Returns the number of locks inserted (rooms x nights).
  async lockNights(input: LockNightsInput): Promise<number> {
    const { hotelId, checkIn, checkOut, kind, bookingId, expiresAt } = input;
    const nights = stayNights(checkIn, checkOut);
    const roomIds = [...new Set(input.roomIds.map(String))];
    if (!roomIds.length) throw new BadRequestException('No rooms given');
    if (kind === RoomLockKind.BLOCKED ? bookingId : !bookingId) {
      throw new Error(`bookingId is required for ${kind} locks only`);
    }
    if (kind === RoomLockKind.HELD && !(expiresAt && expiresAt > new Date())) {
      throw new Error('A Held lock needs an expiresAt in the future');
    }

    const owned = await this.rooms.countDocuments({
      _id: { $in: roomIds },
      hotelId,
    });
    if (owned !== roomIds.length) throw new NotFoundException(ROOM_NOT_FOUND);

    await this.locks.deleteMany({
      roomId: { $in: roomIds },
      date: { $gte: checkIn, $lt: checkOut },
      kind: RoomLockKind.HELD,
      expiresAt: { $lte: new Date() },
    });

    const docs = roomIds.flatMap((roomId) =>
      nights.map((date) => ({
        _id: new Types.ObjectId(),
        roomId,
        hotelId,
        date,
        kind,
        bookingId: bookingId ?? null,
        expiresAt: kind === RoomLockKind.HELD ? expiresAt : null,
      })),
    );
    try {
      await this.locks.insertMany(docs, { ordered: true });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      // Only this call's _ids are deleted; the lock that was already there
      // has another _id and stays.
      await this.locks.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
      throw new ConflictException(ROOMS_NOT_AVAILABLE);
    }
    return docs.length;
  }

  // HTL-17: after payment, the reservation's Held nights become Booked.
  // Returns how many were changed, so the caller can check that all of them
  // were still held (none expired and taken by someone else).
  async confirmHeld(bookingId: string): Promise<number> {
    const res = await this.locks.updateMany(
      { bookingId, kind: RoomLockKind.HELD },
      { $set: { kind: RoomLockKind.BOOKED, expiresAt: null } },
    );
    return res.modifiedCount;
  }

  // HTL-17: how many nights of one reservation are Booked, to check after
  // confirmHeld that none was lost.
  countBooked(bookingId: string): Promise<number> {
    return this.locks
      .countDocuments({ bookingId, kind: RoomLockKind.BOOKED })
      .exec();
  }

  // Hold expiry (HTL-18) and cancellation (HTL-20, HTL-21): frees every night
  // of one reservation.
  async releaseBooking(bookingId: string): Promise<number> {
    const res = await this.locks.deleteMany({ bookingId });
    return res.deletedCount;
  }

  // HTL-06: removes a room's Blocked nights in [from, to). Held and Booked
  // nights are never touched.
  async unblock(roomId: string, from: string, to: string): Promise<number> {
    stayNights(from, to);
    const res = await this.locks.deleteMany({
      roomId,
      date: { $gte: from, $lt: to },
      kind: RoomLockKind.BLOCKED,
    });
    return res.deletedCount;
  }
}
