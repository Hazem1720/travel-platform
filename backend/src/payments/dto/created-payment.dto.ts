import { ApiProperty } from '@nestjs/swagger';

// PAY-01: the answer to POST /bookings/:type/:id/pay. Used only for Swagger.
export class CreatedPaymentDto {
  @ApiProperty({ example: '6737c0a1c1a2b3c4d5e6fc01' })
  paymentId: string;

  @ApiProperty({
    example: 'pi_3QxExample_secret_AbCdEf123',
    description:
      'Pass it to Stripe Elements (stripe.confirmPayment) in the browser. ' +
      'Card details go straight to Stripe and never reach this backend.',
  })
  clientSecret: string;

  @ApiProperty({
    example: 42000,
    description: 'The booking total in cents of the platform currency',
  })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: '2026-11-19T10:10:00.000Z',
    description:
      'End of the hold. After it the PaymentIntent is cancelled and the ' +
      'booking expires.',
  })
  expiresAt: Date;
}

// The answer Stripe gets from POST /payments/webhook.
export class WebhookReceivedDto {
  @ApiProperty({ example: true })
  received: boolean;
}
