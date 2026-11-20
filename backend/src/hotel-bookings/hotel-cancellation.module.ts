import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { HotelBookingsModule } from './hotel-bookings.module';
import { HotelCancellationController } from './hotel-cancellation.controller';
import { HotelCancellationService } from './hotel-cancellation.service';

// Hasan's HTL-21: a user cancels their own reservation. Its own module so it
// stays out of Memo's HotelBookingsModule; it uses the HotelBooking and Hotel
// models, HotelAvailabilityService and HotelSearchService that module
// exports, PaymentsService.refund (PAY-03) and the global notifications.
@Module({
  imports: [HotelBookingsModule, PaymentsModule],
  controllers: [HotelCancellationController],
  providers: [HotelCancellationService],
})
export class HotelCancellationModule {}
