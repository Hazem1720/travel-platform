import { ApiProperty } from '@nestjs/swagger';
import { IsCents } from '../../common/helpers/money';

// HTL-21: POST /hotel-bookings/:id/cancel. The user confirms the refund
// they were shown by GET /hotel-bookings/:id/cancellation; if it is no
// longer right (the hotel changed its tiers, or a day passed), 409.
export class CancelHotelBookingDto {
  @ApiProperty({
    example: 22500,
    description:
      'The refundAmount shown by GET /hotel-bookings/:id/cancellation, USD cents',
  })
  @IsCents()
  refundAmount: number;
}

class TierDto {
  @ApiProperty({ example: 7 }) daysBefore: number;
  @ApiProperty({ example: 50 }) refundPercent: number;
}

// HTL-21: GET /hotel-bookings/:id/cancellation
export class HotelCancellationQuoteDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb20' }) bookingId: string;
  @ApiProperty({ example: 'HT-7K2M9QX4' }) reference: string;
  @ApiProperty({ example: 'Nile View' }) hotelName: string;
  @ApiProperty({ example: '2026-12-05' }) checkIn: string;
  @ApiProperty({ example: '2026-12-08' }) checkOut: string;
  @ApiProperty({ example: 45000, description: 'USD cents' })
  totalAmount: number;
  @ApiProperty({
    example: 10,
    description: "Days until check-in, in the hotel's local date",
  })
  daysBeforeCheckIn: number;
  @ApiProperty({ example: 50 }) refundPercent: number;
  @ApiProperty({
    example: 22500,
    description: 'USD cents; send it back to POST /hotel-bookings/:id/cancel',
  })
  refundAmount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: [TierDto],
    description: "The hotel's tiers, most days first",
  })
  cancellationTiers: TierDto[];
}

class RefundDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fc01' }) refundId: string;
  @ApiProperty({ example: 22500 }) amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    example: 'Pending',
    description: 'Pending, Refunded or Failed',
  })
  status: string;
}

// HTL-21: POST /hotel-bookings/:id/cancel
export class HotelCancellationResultDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb20' }) bookingId: string;
  @ApiProperty({ example: 'HT-7K2M9QX4' }) reference: string;
  @ApiProperty({ example: 'Cancelled' }) status: string;
  @ApiProperty({ example: '2026-11-25T10:00:00.000Z' }) cancelledAt: string;
  @ApiProperty({ example: 50 }) refundPercent: number;
  @ApiProperty({ example: 22500, description: 'USD cents' })
  refundAmount: number;
  @ApiProperty({
    type: RefundDto,
    nullable: true,
    description: 'null when the refund is 0',
  })
  refund: RefundDto | null;
}
