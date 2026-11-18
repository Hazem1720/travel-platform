import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';
import { CancellationTierDto } from '../../common/helpers/cancellation-tiers';

// PAY-02: POST /bookings/:type/:id/accept-policies. The acceptance checkbox
// is sent to the backend: payment stays blocked until accepted is true.
export class AcceptPoliciesDto {
  @ApiProperty({
    example: true,
    description: 'The ticked "I accept the policies" checkbox; must be true',
  })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the policies to continue' })
  accepted: boolean;
}

// Response shapes, used only for Swagger documentation.
class PolicyProviderDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' }) id: string;
  @ApiProperty({ example: 'Nile View Hotel' }) name: string;
}

class BaggageCabinDto {
  @ApiProperty({ example: 'NP101' }) flightNumber: string;
  @ApiProperty({ example: 'Economy' }) cabin: string;
  @ApiProperty({ example: 1, description: 'Free checked bags per passenger' })
  freeBags: number;
  @ApiProperty({ example: 23 }) maxKgPerBag: number;
}

class BaggagePolicyDto {
  @ApiProperty({
    example: 5000,
    nullable: true,
    type: Number,
    description: 'USD cents per extra bag; null if extra bags are not sold',
  })
  extraBagPrice: number | null;
  @ApiProperty({ example: 2 }) maxExtraBags: number;
  @ApiProperty({ type: [BaggageCabinDto] }) cabins: BaggageCabinDto[];
}

export class BookingPoliciesDto {
  @ApiProperty({ example: 'hotel', enum: ['flight', 'hotel'] }) type: string;
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fa10' }) bookingId: string;
  @ApiProperty({ example: 'PendingPayment' }) status: string;
  @ApiProperty({ type: PolicyProviderDto }) provider: PolicyProviderDto;

  @ApiProperty({
    type: [CancellationTierDto],
    example: [
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
    description:
      'Refund by days before check-in or departure, most days first. ' +
      'Empty: no refund on cancellation.',
  })
  cancellationTiers: CancellationTierDto[];

  @ApiPropertyOptional({ example: '14:00', description: 'Hotels only' })
  checkInTime?: string;

  @ApiPropertyOptional({ example: '12:00', description: 'Hotels only' })
  checkOutTime?: string;

  @ApiPropertyOptional({
    type: BaggagePolicyDto,
    description: 'Flights only',
  })
  baggage?: BaggagePolicyDto;

  @ApiProperty({ example: false }) accepted: boolean;

  @ApiProperty({ example: null, nullable: true, type: String })
  policiesAcceptedAt: string | null;

  @ApiProperty({
    example: '2026-11-18T10:10:00.000Z',
    nullable: true,
    type: String,
  })
  expiresAt: string | null;
}

export class PoliciesAcceptedDto {
  @ApiProperty({ example: 'hotel' }) type: string;
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fa10' }) bookingId: string;
  @ApiProperty({ example: true }) accepted: boolean;
  @ApiProperty({ example: '2026-11-18T10:02:00.000Z' })
  policiesAcceptedAt: string;
}
