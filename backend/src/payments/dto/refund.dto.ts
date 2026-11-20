import { ApiProperty } from '@nestjs/swagger';
import { PaymentBookingType, RefundStatus } from '../payment-handler';

// PAY-03: a refund as GET /refunds/:id and the booking details show it.
// Used only for Swagger.
export class RefundDto {
  @ApiProperty({ example: '6737d1a2c1a2b3c4d5e6fd01' })
  _id: string;

  @ApiProperty({ enum: PaymentBookingType, example: PaymentBookingType.HOTEL })
  bookingType: PaymentBookingType;

  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fa10' })
  bookingId: string;

  @ApiProperty({
    example: 37500,
    description: 'Cents of the platform currency',
  })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    enum: RefundStatus,
    example: RefundStatus.REFUNDED,
    description:
      'Pending until Stripe confirms it; Failed if Stripe or the bank refused it',
  })
  status: RefundStatus;

  @ApiProperty({ example: '2026-11-19T09:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-11-19T09:00:02.000Z' })
  updatedAt: Date;
}
