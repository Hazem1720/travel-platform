import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { Airline, AirlineSchema } from './schemas/airline.schema';

// FLT-01. Exports AirlinesService and the Airline model (MongooseModule), so
// Hasan (ACC-13, ACC-15) and Aabsy (FLT-11) can use them by importing
// AirlinesModule.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Airline.name, schema: AirlineSchema }]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [AirlinesService, MongooseModule],
})
export class AirlinesModule {}
