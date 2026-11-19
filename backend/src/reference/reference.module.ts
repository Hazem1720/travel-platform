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
  Currency,
  CurrencySchema,
} from './schemas/reference.schemas';
import { ReferenceSeedService } from './reference-seed.service';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

// Global: any module can inject the Country, City, Airport, Attraction and
// Currency models. GEN-12: seeds them at start-up and lists them publicly.
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
      { name: Currency.name, schema: CurrencySchema },
    ]),
  ],
  controllers: [ReferenceController],
  providers: [ReferenceService, ReferenceSeedService],
  exports: [MongooseModule, ReferenceSeedService],
})
export class ReferenceModule {}
