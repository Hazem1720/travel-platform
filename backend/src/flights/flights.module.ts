import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { AirportsModule } from '../airports/airports.module';
import { AirlineFlightsController } from './airline-flights.controller';
import { FlightStatusJob } from './flight-status.job';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { Flight, FlightSchema } from './schemas/flight.schema';

// FLT-03, FLT-04, FLT-30, GEN-06. Exports FlightsService and the Flight
// model (MongooseModule) for Aabsy (search, holds), Memo (PAY-02) and Hasan
// (FLT-06, FLT-29). The rules are in flight-rules.ts (isBookable,
// bookableFilter, availableSeats).
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Flight.name, schema: FlightSchema }]),
    AirlinesModule,
    AirportsModule,
  ],
  controllers: [FlightsController, AirlineFlightsController],
  providers: [FlightsService, FlightStatusJob],
  exports: [FlightsService, MongooseModule],
})
export class FlightsModule {}
