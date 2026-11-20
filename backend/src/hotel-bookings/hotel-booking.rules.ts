import { Types } from 'mongoose';
import { BookingRoomDto } from './dto/create-hotel-booking.dto';
import { badRequest } from './hotel-search.service';

// HTL-16 and HTL-18 rules. Pure functions: no database, so they are unit
// tested on their own. Money is in integer USD cents (PAY-04).

// HTL-18: how long the rooms are held for payment.
export const HOLD_MINUTES = 10;

export function holdExpiry(now = new Date()): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60_000);
}

// HTL-16, before any room is read: every room at most once, at least one
// guest in every room and at least one adult in the reservation. 400 with
// the field, in the shared validation format.
export function assertRoomSelection(rooms: BookingRoomDto[]): void {
  const seen = new Set<string>();
  rooms.forEach((r, i) => {
    if (seen.has(r.roomId)) {
      throw badRequest(
        `rooms.${i}.roomId`,
        'Each room can be booked only once in a reservation',
      );
    }
    seen.add(r.roomId);
    if (r.adults + r.childAges.length === 0) {
      throw badRequest(`rooms.${i}`, 'Each room needs at least one guest');
    }
  });
  if (!rooms.some((r) => r.adults > 0)) {
    throw badRequest('rooms', 'A reservation needs at least one adult');
  }
}

export interface RoomForBooking {
  _id: Types.ObjectId;
  hotelId: Types.ObjectId;
  name: string;
  type: string;
  maxOccupancy: number;
  pricePerNight: number;
}

// HTL-16, once the rooms are read: every room is in the booked hotel, and no
// room's guests exceed its maximum occupancy. `found` is keyed by room id;
// unknown rooms are the caller's 404.
export function assertRoomsFit(
  hotelId: string,
  rooms: BookingRoomDto[],
  found: Map<string, RoomForBooking>,
): void {
  rooms.forEach((r, i) => {
    const room = found.get(r.roomId)!;
    if (String(room.hotelId) !== String(hotelId)) {
      throw badRequest(
        `rooms.${i}.roomId`,
        'All rooms of a reservation must be in the same hotel',
      );
    }
    const guests = r.adults + r.childAges.length;
    if (guests > room.maxOccupancy) {
      throw badRequest(
        `rooms.${i}`,
        `Room ${room.name} sleeps at most ${room.maxOccupancy} guests, not ${guests}`,
      );
    }
  });
}

export interface PricedRoom {
  roomId: Types.ObjectId;
  name: string;
  type: string;
  adults: number;
  childAges: number[];
  pricePerNight: number;
  subtotal: number;
}

// HTL-16: the price snapshot. Total = sum over rooms of nights x that room's
// price per night at this moment. Two rooms for 3 nights at 100 and 150 USD:
// 3 x 10000 + 3 x 15000 = 75000 cents.
export function priceRooms(
  rooms: BookingRoomDto[],
  found: Map<string, RoomForBooking>,
  nights: number,
): { rooms: PricedRoom[]; totalAmount: number } {
  const priced = rooms.map((r): PricedRoom => {
    const room = found.get(r.roomId)!;
    return {
      roomId: room._id,
      name: room.name,
      type: room.type,
      adults: r.adults,
      childAges: [...r.childAges],
      pricePerNight: room.pricePerNight,
      subtotal: nights * room.pricePerNight,
    };
  });
  return {
    rooms: priced,
    totalAmount: priced.reduce((sum, r) => sum + r.subtotal, 0),
  };
}
