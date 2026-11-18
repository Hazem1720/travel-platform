import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// ITN-18: one document per day of rates from FXRatesAPI, cached so the API is
// called at most about once a day and the last rates still work when it is
// down. rates[X] = how many X one unit of `base` buys (rates[base] = 1).
@Schema({ timestamps: true, collection: 'exchange_rates' })
export class ExchangeRate {
  // "YYYY-MM-DD", the date the rates are for (UTC).
  @Prop({ type: String, required: true, unique: true })
  date: string;

  @Prop({ type: String, required: true })
  base: string;

  @Prop({ type: Map, of: Number, required: true })
  rates: Map<string, number>;

  @Prop({ type: Date, required: true })
  fetchedAt: Date;
}

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;
export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
