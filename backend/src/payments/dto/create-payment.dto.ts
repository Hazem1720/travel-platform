import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { PaymentBookingType } from '../payment-handler';

// PAY-01: POST /api/payments (section 8.7 of the project description).
export class CreatePaymentDto {
  @ApiProperty({ enum: PaymentBookingType, example: PaymentBookingType.FLIGHT })
  @IsEnum(PaymentBookingType)
  bookingType: PaymentBookingType;

  @ApiProperty({ example: '6737b2f4c1a2b3c4d5e6f201' })
  @IsMongoId()
  bookingId: string;
}

// PAY-01: GET /api/payments/:id. Used only for Swagger.
export class PaymentDto {
  @ApiProperty({ example: '6737c0a1c1a2b3c4d5e6fc01' })
  _id: string;

  @ApiProperty({ enum: PaymentBookingType })
  bookingType: PaymentBookingType;

  @ApiProperty({ example: '6737b2f4c1a2b3c4d5e6f201' })
  bookingId: string;

  @ApiProperty({
    example: 42000,
    description: 'Cents of the platform currency',
  })
  amount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ enum: ['Pending', 'Succeeded', 'Failed', 'Expired'] })
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
