import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { FlightChangeController } from './flight-change.controller';
import { FlightChangeService } from './flight-change.service';
import {
  FlightChange,
  FlightChangeSchema,
} from './schemas/flight-change.schema';

// FLT-27 (bonus): its own module next to Hasan's FLT-26. The FlightBooking
// and SeatAssignment models, FlightQuoteService and FlightHoldService come
// from the @Global FlightBookingsModule. It registers the "flight-change"
// payment handler with PaymentsService (PAY-01).
@Module({
  imports: [
    PaymentsModule,
    MongooseModule.forFeature([
      { name: FlightChange.name, schema: FlightChangeSchema },
      { name: Flight.name, schema: FlightSchema },
    ]),
  ],
  controllers: [FlightChangeController],
  providers: [FlightChangeService],
})
export class FlightChangeModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly service: FlightChangeService,
  ) {}

  onModuleInit(): void {
    this.payments.registerHandler(
      PaymentBookingType.FLIGHT_CHANGE,
      this.service,
    );
  }
}
