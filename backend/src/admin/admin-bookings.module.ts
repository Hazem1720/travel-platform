import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';

// Hasan's part of src/admin (see admin.module.ts): ACC-17, GET
// /admin/bookings. Registers the two booking models itself (Mongoose reuses
// the same models) instead of importing the booking modules.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
  ],
  // BON-01 (bonus): GET /admin/analytics.
  controllers: [AdminBookingsController, AdminAnalyticsController],
  providers: [AdminBookingsService, AdminAnalyticsService],
})
export class AdminBookingsModule {}
