import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

// Questions other modules ask about hotel reservations, without reading the
// collection themselves; the hotel twin of FlightBookingsReaderService.
//  - Hasan (ACC-12): hasUpcomingConfirmed(userId).
@Injectable()
export class HotelBookingsReaderService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
  ) {}

  // A Confirmed reservation whose stay is not over: check-in still ahead or
  // the guest still there (a stay is over once its check-out date has
  // passed, HTL-23). Dates are compared as YYYY-MM-DD with today's UTC date.
  async hasUpcomingConfirmed(
    userId: Types.ObjectId | string,
    now = new Date(),
  ): Promise<boolean> {
    if (!isValidObjectId(userId)) return false;
    const today = now.toISOString().slice(0, 10);
    return !!(await this.bookings.exists({
      userId: new Types.ObjectId(String(userId)),
      status: BookingStatus.CONFIRMED,
      checkOut: { $gte: today },
    }));
  }
}
