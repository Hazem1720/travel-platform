import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

// FLT-27 (bonus): PATCH /api/flight-bookings/:id/change-flight
export class ChangeFlightDto {
  @ApiProperty({
    example: '6737a1f4c1a2b3c4d5e6f101',
    description:
      'The outbound flight to fly instead (same route); the current one ' +
      'to keep it',
  })
  @IsMongoId({ message: 'outboundFlightId must be a valid id' })
  outboundFlightId: string;

  @ApiPropertyOptional({
    example: '6737a1f4c1a2b3c4d5e6f102',
    description:
      'Round-trip bookings only, required there: the return flight to fly ' +
      'instead; the current one to keep it',
  })
  @IsOptional()
  @IsMongoId({ message: 'returnFlightId must be a valid id' })
  returnFlightId?: string;
}
