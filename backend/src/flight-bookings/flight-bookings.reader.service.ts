import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { FlightBookingsReader } from '../flights/flight-bookings.reader';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

const toId = (id: Types.ObjectId | string) => new Types.ObjectId(String(id));

// Questions other modules ask about flight bookings, without reading the
// collection themselves (team plan, "Shared contracts"):
//  - Hazem (FLT-05): hasBookings(flightId), confirmedUserIds(flightId),
//    provided under his FLIGHT_BOOKINGS_READER token;
//  - Hasan (ACC-12, ACC-17): hasUpcomingConfirmed(userId).
@Injectable()
export class FlightBookingsReaderService implements FlightBookingsReader {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
  ) {}

  // Any booking on this flight, in any status.
  async hasBookings(flightId: Types.ObjectId | string): Promise<boolean> {
    if (!isValidObjectId(flightId)) return false;
    return !!(await this.bookings.exists({
      'segments.flightId': toId(flightId),
    }));
  }

  // Users with a Confirmed booking on this flight, each once (for schedule
  // change notifications).
  async confirmedUserIds(
    flightId: Types.ObjectId | string,
  ): Promise<Types.ObjectId[]> {
    if (!isValidObjectId(flightId)) return [];
    return this.bookings.distinct('userId', {
      'segments.flightId': toId(flightId),
      status: BookingStatus.CONFIRMED,
    });
  }

  // A Confirmed booking with a flight that has not departed yet.
  async hasUpcomingConfirmed(
    userId: Types.ObjectId | string,
    now = new Date(),
  ): Promise<boolean> {
    if (!isValidObjectId(userId)) return false;
    return !!(await this.bookings.exists({
      userId: toId(userId),
      status: BookingStatus.CONFIRMED,
      segments: { $elemMatch: { departureAt: { $gt: now } } },
    }));
  }
}
