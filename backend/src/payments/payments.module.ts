import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingPoliciesController } from './booking-policies.controller';
import {
  PaymentsController,
  StripeWebhookController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { StripeGateway } from './stripe.gateway';

// PAY-01 to PAY-03 (Memo). Booking modules import it and register their
// PaymentHandler in onModuleInit (see payments.service.ts). Nest creates one
// PaymentsService for the whole app, so every handler lands in the same
// registry. Here: PAY-02's policy routes, PAY-01's pay route and Stripe
// webhook. The Refund schema comes with PAY-03.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
  ],
  controllers: [
    BookingPoliciesController,
    PaymentsController,
    StripeWebhookController,
  ],
  providers: [PaymentsService, StripeGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
