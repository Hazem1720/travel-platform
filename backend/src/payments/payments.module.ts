import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';

// PAY-01 to PAY-03 (Memo). Booking modules import it and register their
// PaymentHandler in onModuleInit (see payments.service.ts). Nest creates one
// PaymentsService for the whole app, so every handler lands in the same
// registry. The Payment and Refund schemas, the routes and the Stripe
// webhook come with PAY-01 and PAY-03.
@Module({
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
