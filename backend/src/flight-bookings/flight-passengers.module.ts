import { Module } from '@nestjs/common';
import { FlightsModule } from '../flights/flights.module';
import { FlightBookingsModule } from './flight-bookings.module';
import { FlightPassengersController } from './flight-passengers.controller';
import { FlightPassengersService } from './flight-passengers.service';

// Hasan's FLT-29: an airline moderator's bookings and passenger list per
// flight. Its own module so it stays out of Mostafa's FlightBookingsModule;
// it reads the FlightBooking model that module exports and checks the
// flight with Hazem's FlightsService.getOwned.
@Module({
  imports: [FlightBookingsModule, FlightsModule],
  controllers: [FlightPassengersController],
  providers: [FlightPassengersService],
})
export class FlightPassengersModule {}
