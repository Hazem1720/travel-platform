import { Module } from '@nestjs/common';
import { FlightsModule } from '../flights/flights.module';
import { PaymentsModule } from '../payments/payments.module';
import { FlightBookingsModule } from './flight-bookings.module';
import { FlightCancellationController } from './flight-cancellation.controller';
import { FlightCancellationService } from './flight-cancellation.service';

// Hasan's FLT-06: POST /flights/:id/cancel. Its own module, so Hazem's
// FlightsModule and Mostafa's FlightBookingsModule stay untouched. Uses the
// Flight and FlightBooking models they export, Hazem's getOwned/toViews,
// Memo's PaymentsService (releaseInventory, refund) and the global
// NotificationsService.
@Module({
  imports: [FlightBookingsModule, FlightsModule, PaymentsModule],
  controllers: [FlightCancellationController],
  providers: [FlightCancellationService],
})
export class FlightCancellationModule {}
