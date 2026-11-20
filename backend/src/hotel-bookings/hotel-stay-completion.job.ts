import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { HotelSearchService } from './hotel-search.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

const HOUR_MS = 60 * 60 * 1000;

// The latest calendar date anywhere on Earth right now (UTC+14). A stay whose
// check-out date is not before it cannot be over in any city yet.
export function latestToday(now = new Date()): string {
  return new Date(now.getTime() + 14 * HOUR_MS).toISOString().slice(0, 10);
}

// HTL-23 (Hasan), every minute: "A Confirmed reservation becomes Completed
// once its check-out date has passed" (GEN-11: Confirmed -> Completed).
// Only Completed reservations can be reviewed. The hotel twin of the flight
// job (FlightBookingJobs.completeLanded).
//
// "Today" is the date in the hotel's city (HotelSearchService.today, the
// same rule as HTL-15 and HTL-21), never UTC: a stay in New York is not over
// at 01:00 UTC on its check-out day, and one in Tokyo is over hours before
// UTC midnight. On the check-out day itself the stay is still Confirmed.
// HTL-20's tabs and ACC-12's check rely on this status.
@Injectable()
export class HotelStayCompletionJob {
  private readonly logger = new Logger(HotelStayCompletionJob.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly search: HotelSearchService,
  ) {}

  // Returns how many reservations it completed.
  @Cron(CronExpression.EVERY_MINUTE)
  async completeStays(now: Date = new Date()): Promise<number> {
    try {
      // Only stays that may be over somewhere: a small set each minute.
      const candidates = await this.bookings
        .find(
          {
            status: BookingStatus.CONFIRMED,
            checkOut: { $lt: latestToday(now) },
          },
          { hotelId: 1, checkOut: 1 },
        )
        .lean<
          { _id: Types.ObjectId; hotelId: Types.ObjectId; checkOut: string }[]
        >();
      if (!candidates.length) return 0;

      const hotelIds = [...new Set(candidates.map((b) => String(b.hotelId)))];
      const hotels = await this.hotels
        .find({ _id: { $in: hotelIds } }, { cityId: 1 })
        .lean();
      const cityOf = new Map(hotels.map((h) => [String(h._id), h.cityId]));
      const todayIn = new Map<string, string>();
      for (const cityId of new Set(cityOf.values())) {
        todayIn.set(cityId, await this.search.today({ cityId }, now));
      }
      // A hotel that no longer exists falls back to the UTC date.
      const utc = now.toISOString().slice(0, 10);
      const over = candidates
        .filter((b) => {
          const cityId = cityOf.get(String(b.hotelId));
          return b.checkOut < ((cityId && todayIn.get(cityId)) || utc);
        })
        .map((b) => b._id);
      if (!over.length) return 0;

      // Still conditional on Confirmed: a cancel in between wins.
      const res = await this.bookings.updateMany(
        { _id: { $in: over }, status: BookingStatus.CONFIRMED },
        { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
      );
      return res.modifiedCount;
    } catch (err) {
      this.logger.error(`Completed job failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
