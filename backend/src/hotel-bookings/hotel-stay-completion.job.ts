import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

// HTL-23 (Hasan), every minute: "A Confirmed reservation becomes Completed
// once its check-out date has passed" (GEN-11: Confirmed -> Completed).
// Only Completed reservations can be reviewed. The hotel twin of the flight
// job (FlightBookingJobs.completeLanded). Check-out dates are YYYY-MM-DD and
// compared with today's UTC date, so on the check-out day the stay is still
// Confirmed.
@Injectable()
export class HotelStayCompletionJob {
  private readonly logger = new Logger(HotelStayCompletionJob.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
  ) {}

  // Returns how many reservations it completed.
  @Cron(CronExpression.EVERY_MINUTE)
  async completeStays(now: Date = new Date()): Promise<number> {
    const today = now.toISOString().slice(0, 10);
    try {
      const res = await this.bookings.updateMany(
        { status: BookingStatus.CONFIRMED, checkOut: { $lt: today } },
        { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
      );
      return res.modifiedCount;
    } catch (err) {
      this.logger.error(`Completed job failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
