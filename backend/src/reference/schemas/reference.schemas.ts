import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// The provided datasets use text identifiers (cairo, EG, CAI, att-1).
// We keep them as the _id so every team and the final evaluation match.

@Schema({ collection: 'countries' })
export class Country {
  @Prop({ type: String }) _id: string; // e.g. EG
  @Prop({ required: true }) name: string;
  @Prop({ required: true }) currency: string;
}
export const CountrySchema = SchemaFactory.createForClass(Country);
export type CountryDocument = HydratedDocument<Country>;

@Schema({ collection: 'cities' })
export class City {
  @Prop({ type: String }) _id: string; // e.g. cairo
  @Prop({ required: true }) name: string;
  @Prop({ type: String, ref: 'Country', required: true, index: true }) countryCode: string;
}
export const CitySchema = SchemaFactory.createForClass(City);
export type CityDocument = HydratedDocument<City>;

@Schema({ collection: 'airports' })
export class Airport {
  @Prop({ type: String }) _id: string; // IATA code, e.g. CAI
  @Prop({ required: true }) name: string;
  @Prop({ type: String, ref: 'City', required: true, index: true }) cityId: string;
  @Prop({ type: String, ref: 'Country', required: true }) countryCode: string;
  @Prop({ type: String, default: null }) timeZone: string | null; // IANA, e.g. Africa/Cairo
}
export const AirportSchema = SchemaFactory.createForClass(Airport);
export type AirportDocument = HydratedDocument<Airport>;

@Schema({ collection: 'attractions' })
export class Attraction {
  @Prop({ type: String }) _id: string; // e.g. att-1
  @Prop({ required: true }) name: string;
  @Prop({ type: String, ref: 'City', required: true, index: true }) cityId: string;
}
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
export type AttractionDocument = HydratedDocument<Attraction>;