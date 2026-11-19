import { Global, Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { AirportsModule } from '../airports/airports.module';
import { FLIGHT_BOOKINGS_READER } from '../flights/flight-bookings.reader';
import { FlightsModule } from '../flights/flights.module';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsModule } from '../payments/payments.module';
import { PaymentsService } from '../payments/payments.service';
import { FlightBookingJobs } from './flight-booking.jobs';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsReaderService } from './flight-bookings.reader.service';
import { FlightConfirmationService } from './flight-confirmation.service';
import { FlightDetailsService } from './flight-details.service';
import { FlightHoldService } from './flight-hold.service';
import { FlightPaymentHandler } from './flight-payment.handler';
import { FlightQuoteService } from './flight-quote.service';
import { FlightSearchController } from './flight-search.controller';
import { FlightSearchService } from './flight-search.service';
import { MyFlightBookingsController } from './my-flight-bookings.controller';
import { MyFlightBookingsService } from './my-flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

// Flight search and bookings (FLT-11 to FLT-23). @Global() so that:
//  - Hazem's FlightsService gets FLIGHT_BOOKINGS_READER (FLT-05) without
//    importing this module;
//  - Hasan (FLT-25, FLT-26, ACC-12) and Moharm (ITN-26) can inject
//    FlightBookingsReaderService, FlightSearchService and the FlightBooking
//    model.
// The flight PaymentHandler is registered with Memo's PaymentsService at
// startup (PAY-01).
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
    FlightsModule,
    AirlinesModule,
    AirportsModule,
    PaymentsModule,
  ],
  controllers: [
    FlightSearchController,
    FlightBookingsController,
    MyFlightBookingsController,
  ],
  providers: [
    FlightSearchService,
    FlightDetailsService,
    FlightQuoteService,
    FlightHoldService,
    FlightConfirmationService,
    FlightBookingJobs,
    FlightBookingsReaderService,
    {
      provide: FLIGHT_BOOKINGS_READER,
      useExisting: FlightBookingsReaderService,
    },
    FlightPaymentHandler,
    MyFlightBookingsService,
  ],
  exports: [
    FlightSearchService,
    FlightBookingsReaderService,
    FLIGHT_BOOKINGS_READER,
    MongooseModule,
  ],
})
export class FlightBookingsModule implements OnModuleInit {
  constructor(
    private readonly payments: PaymentsService,
    private readonly handler: FlightPaymentHandler,
  ) {}

  onModuleInit(): void {
    this.payments.registerHandler(PaymentBookingType.FLIGHT, this.handler);
  }
}
