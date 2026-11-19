import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingPoliciesController } from './booking-policies.controller';
import {
  PaymentsController,
  RefundsController,
  StripeWebhookController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeGateway } from './stripe.gateway';

// PAY-01 to PAY-03 (Memo). Booking modules import it and register their
// PaymentHandler in onModuleInit (see payments.service.ts). Nest creates one
// PaymentsService for the whole app, so every handler lands in the same
// registry. Here: PAY-02's policy routes, PAY-01's pay route and Stripe
// webhook, and PAY-03's refunds (Refund schema, GET /refunds/:id).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [
    BookingPoliciesController,
    PaymentsController,
    StripeWebhookController,
    RefundsController,
  ],
  providers: [PaymentsService, StripeGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
