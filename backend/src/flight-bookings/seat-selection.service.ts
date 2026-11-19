import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import {
  CabinCategory,
  Flight,
  FlightDocument,
} from '../flights/schemas/flight.schema';
import { PassengerType } from './flight-booking.rules';
import { BOOKING_NOT_FOUND } from './flight-confirmation.service';
import { SelectSeatDto } from './dto/select-seat.dto';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import {
  SeatAssignment,
  SeatAssignmentDocument,
} from './schemas/seat-assignment.schema';
import { normalizeSeat, seatLabels, seatLetters } from './seat-map';

type LeanBooking = FlightBooking & { _id: Types.ObjectId };

export interface SeatView {
  seat: string;
  // Taken by another booking.
  taken: boolean;
  // Index of this booking's passenger in the seat, if any.
  passengerIndex: number | null;
}

export interface SegmentSeats {
  segment: number;
  flightId: Types.ObjectId;
  flightNumber: string;
  from: string;
  to: string;
  cabin: CabinCategory;
  letters: string[];
  seats: SeatView[];
  // This booking's passengers: their seat, or null (infants never have one).
  passengers: { index: number; fullName: string; seat: string | null }[];
}

// A seat is held while its booking is Confirmed or Completed, or still
// PendingPayment inside its 10-minute hold. Expired and Cancelled bookings
// release their seats without anyone having to delete them.
function holdsSeats(b: Pick<FlightBooking, 'status' | 'expiresAt'>): boolean {
  if (b.status === BookingStatus.CONFIRMED) return true;
  if (b.status === BookingStatus.COMPLETED) return true;
  return (
    b.status === BookingStatus.PENDING_PAYMENT &&
    !!b.expiresAt &&
    new Date(b.expiresAt).getTime() > Date.now()
  );
}

const isDuplicate = (err: unknown) => (err as { code?: number }).code === 11000;

// FLT-28 (bonus): seat selection. Each passenger (not infants) of a
// PendingPayment or Confirmed booking picks a free seat in the booked cabin
// of each flight, before it departs, and can change it. A seat belongs to one
// passenger only: the unique index decides a race (one 201/200, one 409).
@Injectable()
export class SeatSelectionService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(SeatAssignment.name)
    private readonly assignments: Model<SeatAssignmentDocument>,
  ) {}

  // The seat map of every flight in the booking, with free, taken and this
  // booking's seats.
  async seatsFor(user: AuthUser, bookingId: string): Promise<SegmentSeats[]> {
    const booking = await this.ownedBooking(user, bookingId);
    const mine = await this.assignments.find({ bookingId: booking._id }).lean();
    return Promise.all(
      booking.segments.map(async (s, i) => {
        const total = await this.cabinSeats(s.flightId, s.cabinId);
        const taken = await this.takenSeats(s.flightId, s.cabinId);
        const mineHere = mine.filter((a) => a.segment === i);
        const byPassenger = new Map(
          mineHere.map((a) => [a.passengerIndex, a.seat]),
        );
        const bySeat = new Map(mineHere.map((a) => [a.seat, a.passengerIndex]));
        return {
          segment: i,
          flightId: s.flightId,
          flightNumber: s.flightNumber,
          from: s.from,
          to: s.to,
          cabin: s.cabin,
          letters: seatLetters(s.cabin),
          seats: seatLabels(s.cabin, total).map((seat) => ({
            seat,
            taken: taken.has(seat) && !bySeat.has(seat),
            passengerIndex: bySeat.get(seat) ?? null,
          })),
          passengers: booking.passengers.map((p, index) => ({
            index,
            fullName: p.fullName,
            seat: byPassenger.get(index) ?? null,
          })),
        };
      }),
    );
  }

  // PATCH /api/flight-bookings/:id/seat
  async selectSeat(user: AuthUser, bookingId: string, dto: SelectSeatDto) {
    const booking = await this.ownedBooking(user, bookingId);
    if (!holdsSeats(booking)) {
      throw new BadRequestException(
        'Seats can be chosen only for a Confirmed booking or one awaiting payment',
      );
    }
    const segment = booking.segments[dto.segment];
    if (!segment) {
      throw this.fieldError('segment', 'This booking has no such flight');
    }
    if (new Date(segment.departureAt).getTime() <= Date.now()) {
      throw this.fieldError('segment', 'This flight has already departed');
    }
    const passenger = booking.passengers[dto.passengerIndex];
    if (!passenger) {
      throw this.fieldError('passengerIndex', 'No such passenger');
    }
    if (passenger.type === PassengerType.INFANT) {
      throw this.fieldError(
        'passengerIndex',
        "Infants sit on an adult's lap and get no seat",
      );
    }
    const total = await this.cabinSeats(segment.flightId, segment.cabinId);
    const seat = normalizeSeat(segment.cabin, total, dto.seat);
    if (!seat) {
      throw this.fieldError(
        'seat',
        `No seat ${dto.seat} in ${segment.cabin} on this flight`,
      );
    }

    const key = {
      bookingId: booking._id,
      segment: dto.segment,
      passengerIndex: dto.passengerIndex,
    };
    const where = { flightId: segment.flightId, cabinId: segment.cabinId };
    const current = await this.assignments.findOne(key).lean();
    if (current?.seat !== seat) {
      await this.claim(where, seat, async () => {
        if (current) {
          await this.assignments.updateOne(
            { _id: current._id },
            { $set: { seat } },
          );
        } else {
          await this.assignments.create({ ...where, ...key, seat });
        }
      });
    }
    return {
      bookingId: booking._id,
      segment: dto.segment,
      passengerIndex: dto.passengerIndex,
      flightNumber: segment.flightNumber,
      cabin: segment.cabin,
      seat,
    };
  }

  // Runs write(); if the seat is held by another booking it is 409, but a
  // seat left by an Expired or Cancelled booking is freed and tried again.
  private async claim(
    where: { flightId: Types.ObjectId; cabinId: Types.ObjectId },
    seat: string,
    write: () => Promise<unknown>,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await write();
        return;
      } catch (err) {
        if (!isDuplicate(err)) throw err;
        const holder = await this.assignments
          .findOne({ ...where, seat })
          .lean();
        const holding = holder
          ? await this.bookings
              .findById(holder.bookingId, { status: 1, expiresAt: 1 })
              .lean()
          : null;
        if (holder && holding && holdsSeats(holding)) break;
        if (holder) {
          await this.assignments.deleteOne({ _id: holder._id });
        }
      }
    }
    throw new ConflictException(`Seat ${seat} is already taken`);
  }

  private async ownedBooking(user: AuthUser, id: string): Promise<LeanBooking> {
    if (!isValidObjectId(id)) throw new NotFoundException(BOOKING_NOT_FOUND);
    const booking = await this.bookings.findById(id).lean<LeanBooking>();
    if (!booking) throw new NotFoundException(BOOKING_NOT_FOUND);
    assertOwner(booking.userId, user, BOOKING_NOT_FOUND);
    return booking;
  }

  private async cabinSeats(
    flightId: Types.ObjectId,
    cabinId: Types.ObjectId,
  ): Promise<number> {
    const flight = await this.flights
      .findById(flightId, { cabins: 1 })
      .lean<{ cabins: { _id: Types.ObjectId; totalSeats: number }[] }>();
    const cabin = flight?.cabins.find((c) => String(c._id) === String(cabinId));
    return cabin?.totalSeats ?? 0;
  }

  // Seats of the cabin held by active bookings (holdsSeats).
  private async takenSeats(
    flightId: Types.ObjectId,
    cabinId: Types.ObjectId,
  ): Promise<Set<string>> {
    const rows = await this.assignments
      .find({ flightId, cabinId }, { seat: 1, bookingId: 1 })
      .lean();
    if (!rows.length) return new Set();
    const active = await this.bookings
      .find(
        { _id: { $in: [...new Set(rows.map((r) => String(r.bookingId)))] } },
        { status: 1, expiresAt: 1 },
      )
      .lean();
    const holding = new Set(
      active.filter(holdsSeats).map((b) => String(b._id)),
    );
    return new Set(
      rows.filter((r) => holding.has(String(r.bookingId))).map((r) => r.seat),
    );
  }

  private fieldError(field: string, message: string) {
    return new BadRequestException({
      error: 'Bad Request',
      message,
      details: { [field]: [message] },
    });
  }
}
