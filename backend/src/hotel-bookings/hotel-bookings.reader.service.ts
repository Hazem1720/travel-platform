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
  // the guest still there. A stay stays Confirmed until its check-out date
  // has passed in the hotel's city; then HotelStayCompletionJob (HTL-23)
  // makes it Completed. So the status alone answers, with no UTC date.
  async hasUpcomingConfirmed(
    userId: Types.ObjectId | string,
  ): Promise<boolean> {
    if (!isValidObjectId(userId)) return false;
    return !!(await this.bookings.exists({
      userId: new Types.ObjectId(String(userId)),
      status: BookingStatus.CONFIRMED,
    }));
  }
}
