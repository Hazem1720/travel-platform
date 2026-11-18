import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Flight, FlightDocument, FlightStatus } from './schemas/flight.schema';

// FLT-30: once a Scheduled flight's departure time has passed it becomes
// Departed. Runs every minute; isBookable() also checks the time, so search
// and holds never depend on when this last ran.
@Injectable()
export class FlightStatusJob {
  private readonly logger = new Logger(FlightStatusJob.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async markDeparted(now: Date = new Date()): Promise<number> {
    try {
      const res = await this.flights.updateMany(
        { status: FlightStatus.SCHEDULED, departureAt: { $lte: now } },
        { $set: { status: FlightStatus.DEPARTED } },
      );
      return res.modifiedCount;
    } catch (err) {
      this.logger.error(`Departed job failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
