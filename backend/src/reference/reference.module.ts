import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Airport,
  AirportSchema,
  Attraction,
  AttractionSchema,
  City,
  CitySchema,
  Country,
  CountrySchema,
} from './schemas/reference.schemas';

// Global: any module can inject the Country, City, Airport and Attraction models.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class ReferenceModule {}