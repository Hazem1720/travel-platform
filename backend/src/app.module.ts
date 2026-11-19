import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminAccountsModule } from './admin/admin-accounts.module';
import { AdminModule } from './admin/admin.module';
import { AdminBookingsModule } from './admin/admin-bookings.module';
import { AirlinesModule } from './airlines/airlines.module';
import { AirportsModule } from './airports/airports.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BlogModule } from './blog/blog.module';
import { CommentsModule } from './comments/comments.module';
import { ReportsModule } from './reports/reports.module';
import { validateEnv } from './config/env.validation';
import { FlightBookingsModule } from './flight-bookings/flight-bookings.module';
import { FlightBookingCancellationModule } from './flight-bookings/flight-booking-cancellation.module';
import { FlightChangeModule } from './flight-bookings/flight-change.module';
import { EmailModule } from './email/email.module';
import { FlightPassengersModule } from './flight-bookings/flight-passengers.module';
import { FavouritesModule } from './favourites/favourites.module';
import { FlightsModule } from './flights/flights.module';
import { HotelBookingsModule } from './hotel-bookings/hotel-bookings.module';
import { HotelReservationsModule } from './hotel-bookings/hotel-reservations.module';
import { HotelCancellationModule } from './hotel-bookings/hotel-cancellation.module';
import { HotelsModule } from './hotels/hotels.module';
import { FlightCancellationModule } from './flight-bookings/flight-cancellation.module';
import { ItinerariesModule } from './itineraries/itineraries.module';
import { ItineraryPdfModule } from './itinerary-pdf/itinerary-pdf.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { ReferenceModule } from './reference/reference.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGODB_URI'),
      }),
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    ReferenceModule,
    AirlinesModule,
    AirportsModule,
    // Before FlightsModule: GET /flights/search (FLT-11) must be registered
    // before any GET /flights/:id.
    FlightBookingsModule,
    FlightsModule,
    // FLT-26: GET /flight-bookings/:id/cancellation and POST .../cancel.
    FlightBookingCancellationModule,
    // FLT-29: GET /flights/:id/bookings and /passengers/export.
    FlightPassengersModule,
    // FLT-27 (bonus): change a confirmed flight booking.
    FlightChangeModule,
    UploadsModule,
    NotificationsModule,
    EmailModule,
    AuditModule,
    // Before HotelsModule: GET /hotels/search (HTL-11) must be registered
    // before GET /hotels/:id.
    HotelBookingsModule,
    HotelsModule,
    // HTL-22: GET /hotels/:id/reservations.
    HotelReservationsModule,
    // HTL-21: GET /hotel-bookings/:id/cancellation and POST .../cancel.
    HotelCancellationModule,
    PaymentsModule,
    // FLT-06: POST /flights/:id/cancel.
    FlightCancellationModule,
    ItinerariesModule,
    ItineraryPdfModule,
    FavouritesModule,
    BlogModule,
    AdminAccountsModule,
    AdminModule,
    // ACC-17: GET /admin/bookings.
    AdminBookingsModule,
    CommentsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
