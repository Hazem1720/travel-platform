import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { PaymentsModule } from '../payments/payments.module';
import { Airport, AirportSchema } from '../reference/schemas/reference.schemas';
import { FlightBookingCancellationController } from './flight-booking-cancellation.controller';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';

// Hasan's FLT-26: a user cancels their own flight booking. Its own module so
// it stays out of Mostafa's FlightBookingsModule; that module is @Global and
// exports the FlightBooking and SeatAssignment models. The Airline model
// comes from AirlinesModule; Flight and Airport are registered here
// (Mongoose reuses the one model either way).
@Module({
  imports: [
    AirlinesModule,
    PaymentsModule,
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: Airport.name, schema: AirportSchema },
    ]),
  ],
  controllers: [FlightBookingCancellationController],
  providers: [FlightBookingCancellationService],
})
export class FlightBookingCancellationModule {}
