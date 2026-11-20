import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { FlightHoldService } from './flight-hold.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

// GEN-11 flight jobs, every minute (conventions.md, "Hold expiry"):
//  - PendingPayment past expiresAt -> Expired, held seats released (FLT-22);
//  - Confirmed -> Completed once the last segment has landed (FLT-25, ACC-12).
// Holds never depend on this job: hold() releases a flight's expired holds
// itself before reserving.
@Injectable()
export class FlightBookingJobs {
  private readonly logger = new Logger(FlightBookingJobs.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly holds: FlightHoldService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireHolds(): Promise<void> {
    try {
      await this.holds.releaseExpiredHolds();
    } catch (err) {
      this.logger.error(`Hold expiry job failed: ${(err as Error).message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async completeLanded(now: Date = new Date()): Promise<number> {
    try {
      // No segment still in the air or yet to fly.
      const res = await this.bookings.updateMany(
        {
          status: BookingStatus.CONFIRMED,
          segments: { $not: { $elemMatch: { arrivalAt: { $gt: now } } } },
        },
        { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
      );
      return res.modifiedCount;
    } catch (err) {
      this.logger.error(`Completed job failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
