import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DaysController } from './days.controller';
import { DaysService } from './days.service';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

// ITN requirements (Moharm). Exports the service and the Itinerary model
// (MongooseModule), so Hafez (BLG-12, GEN-09, GEN-10) and Memo (BON-02) can
// use them by importing ItinerariesModule. Country and City come from the
// global ReferenceModule.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [ItinerariesController, DaysController],
  providers: [ItinerariesService, DaysService],
  exports: [ItinerariesService, MongooseModule],
})
export class ItinerariesModule {}
