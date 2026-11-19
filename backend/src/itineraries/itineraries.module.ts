import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirportsModule } from '../airports/airports.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  ActivitiesController,
  DayActivitiesController,
} from './activities.controller';
import { ActivitiesService } from './activities.service';
import { ActivityImagesService } from './activity-images.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItineraryHotelsService } from './itinerary-hotels.service';
import { PublicItinerariesController } from './public-itineraries.controller';
import { PublicItinerariesService } from './public-itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import { TransportCostsController } from './transport-costs.controller';
import { TransportCostsService } from './transport-costs.service';

// ITN requirements (Moharm). Exports the service and the Itinerary model
// (MongooseModule), so Hafez (BLG-12), Emad (GEN-09, GEN-10) and Memo (BON-02) can
// use them by importing ItinerariesModule. Country and City come from the
// global ReferenceModule.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      // Read only: the preferred currency (ITN-18) and, for public
      // itineraries, the author's name and status (ITN-21, ACC-12).
      { name: User.name, schema: UserSchema },
    ]),
    ExchangeRatesModule,
    // ITN-25: Memo's hotel search (HTL-11).
    HotelBookingsModule,
    // ITN-26: airports (Hazem) and Aabsy's flight search (FLT-11, FLT-12).
    AirportsModule,
    FlightBookingsModule,
  ],
  // PublicItinerariesController first: GET /itineraries/public/... must be
  // matched before the :id routes.
  controllers: [
    PublicItinerariesController,
    ItinerariesController,
    DaysController,
    DayActivitiesController,
    ActivitiesController,
    TransportCostsController,
    BudgetsController,
  ],
  providers: [
    ItinerariesService,
    DaysService,
    ActivitiesService,
    ActivityImagesService,
    TransportCostsService,
    BudgetsService,
    PublicItinerariesService,
    ItineraryHotelsService,
    ItineraryFlightsService,
  ],
  exports: [ItinerariesService, PublicItinerariesService, MongooseModule],
})
export class ItinerariesModule {}
