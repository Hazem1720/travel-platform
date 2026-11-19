import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { City, CitySchema } from '../reference/schemas/reference.schemas';
import { ItineraryPdfController } from './itinerary-pdf.controller';
import { ItineraryPdfService } from './itinerary-pdf.service';

// ITN-28 (Memo, bonus): GET /itineraries/:id/pdf. A module of its own: it
// uses Moharm's exported ItinerariesService (ownership) and reads city
// names, so nothing in src/itineraries changes.
@Module({
  imports: [
    ItinerariesModule,
    MongooseModule.forFeature([{ name: City.name, schema: CitySchema }]),
  ],
  controllers: [ItineraryPdfController],
  providers: [ItineraryPdfService],
})
export class ItineraryPdfModule {}
