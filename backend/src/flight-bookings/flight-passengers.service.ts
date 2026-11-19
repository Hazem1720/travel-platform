import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { FlightsService } from '../flights/flights.service';
import { FlightBookingsQueryDto } from './dto/flight-passengers.dto';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

// Bookings a moderator sees: paid ones, flying or cancelled. Holds that were
// never paid (PendingPayment, Expired) are not bookings yet.
export const MODERATOR_VISIBLE = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
];
// The passenger list (CSV): only people who are flying or have flown.
export const ON_BOARD = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED];

export const CSV_HEADER = [
  'Booking reference',
  'Passenger name',
  'Passenger type',
  'Date of birth',
  'Passport number',
  'Cabin',
  'Booking status',
];

// One CSV field. Quoted, with quotes doubled. A value starting with = + - @
// (or a tab/CR) is prefixed with ' so a spreadsheet never runs it as a
// formula: names and passports are typed by users.
export function csvField(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

interface PassengerRow {
  reference: string;
  status: string;
  cabin: string;
  passengers: {
    fullName: string;
    type: string;
    dateOfBirth: string;
    passportNumber: string;
  }[];
}

// FLT-29 (Hasan): an airline moderator's view of one of their flights: its
// bookings, seats remaining per cabin, and the passenger list as CSV. The
// flight must belong to the moderator's airline (Hazem's getOwned: 404 for
// an unknown flight, 403 for another airline's).
@Injectable()
export class FlightPassengersService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly flights: FlightsService,
  ) {}

  // GET /flights/:id/bookings
  async listBookings(
    user: AuthUser,
    flightId: string,
    { page, limit }: FlightBookingsQueryDto,
  ) {
    const flight = await this.flights.getOwned(user, flightId);
    const id = new Types.ObjectId(String(flight._id));
    const filter = {
      'segments.flightId': id,
      status: { $in: MODERATOR_VISIBLE },
    };
    const [data, total] = await Promise.all([
      this.bookings.aggregate([
        { $match: filter },
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        ...this.thisFlightSegment(id),
        {
          $project: {
            reference: 1,
            status: 1,
            cabin: '$segment.cabin',
            seats: '$segment.seats',
            passengers: {
              $map: {
                input: '$passengers',
                as: 'p',
                in: { fullName: '$$p.fullName', type: '$$p.type' },
              },
            },
          },
        },
      ]),
      this.bookings.countDocuments(filter),
    ]);
    return {
      flight: {
        _id: flight._id,
        flightNumber: flight.flightNumber,
        from: flight.from,
        to: flight.to,
        departureAt: flight.departureAt,
        status: flight.status,
      },
      seats: (flight.cabins ?? []).map((c) => ({
        category: c.category,
        totalSeats: c.totalSeats,
        bookedSeats: c.bookedSeats ?? 0,
        heldSeats: c.heldSeats ?? 0,
        remainingSeats: Math.max(
          0,
          c.totalSeats - (c.bookedSeats ?? 0) - (c.heldSeats ?? 0),
        ),
      })),
      ...paginated(data, total, page, limit),
    };
  }

  // GET /flights/:id/passengers/export: every passenger of the flight's
  // Confirmed and Completed bookings, by booking reference.
  async exportPassengers(
    user: AuthUser,
    flightId: string,
  ): Promise<{ filename: string; csv: string }> {
    const flight = await this.flights.getOwned(user, flightId);
    const id = new Types.ObjectId(String(flight._id));
    const rows = await this.bookings.aggregate<PassengerRow>([
      { $match: { 'segments.flightId': id, status: { $in: ON_BOARD } } },
      { $sort: { reference: 1, _id: 1 } },
      ...this.thisFlightSegment(id),
      {
        $project: {
          reference: 1,
          status: 1,
          cabin: '$segment.cabin',
          passengers: 1,
        },
      },
    ]);
    const lines: unknown[][] = [CSV_HEADER];
    for (const b of rows) {
      for (const p of b.passengers ?? []) {
        lines.push([
          b.reference,
          p.fullName,
          p.type,
          p.dateOfBirth,
          p.passportNumber,
          b.cabin,
          b.status,
        ]);
      }
    }
    const date = new Date(flight.departureAt).toISOString().slice(0, 10);
    return {
      filename: `${flight.flightNumber}-${date}-passengers.csv`,
      csv: toCsv(lines),
    };
  }

  // A round trip has two segments: keep the one on this flight, for its
  // cabin and seats.
  private thisFlightSegment(flightId: Types.ObjectId) {
    return [
      {
        $addFields: {
          segment: {
            $first: {
              $filter: {
                input: '$segments',
                as: 's',
                cond: { $eq: ['$$s.flightId', flightId] },
              },
            },
          },
        },
      },
    ];
  }
}
