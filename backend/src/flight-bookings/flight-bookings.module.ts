import { Module } from '@nestjs/common';
import { AirlinesModule } from '../airlines/airlines.module';
import { AirportsModule } from '../airports/airports.module';
import { FlightsModule } from '../flights/flights.module';
import { FlightDetailsService } from './flight-details.service';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';

// Flight search and bookings (FLT-11 to FLT-23). Exports FlightSearchService
// for Moharm's itineraries (ITN-26).
@Module({
  imports: [FlightsModule, AirlinesModule, AirportsModule],
  controllers: [FlightSearchController],
  providers: [FlightSearchService, FlightDetailsService],
  exports: [FlightSearchService],
})
export class FlightBookingsModule {}
