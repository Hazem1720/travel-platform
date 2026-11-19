import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

// FLT-28 (bonus): PATCH /api/flight-bookings/:id/seat
export class SelectSeatDto {
  @ApiProperty({
    example: 0,
    minimum: 0,
    maximum: 1,
    description: '0 = outbound flight, 1 = return flight (round trip)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  segment: number;

  @ApiProperty({
    example: 0,
    minimum: 0,
    description: "The passenger's index in the booking (0 = first)",
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  passengerIndex: number;

  @ApiProperty({ example: '12A', description: 'Row number and seat letter' })
  @IsString()
  @Matches(/^\s*\d{1,3}[A-Fa-f]\s*$/, {
    message: 'seat must look like 12A',
  })
  seat: string;
}
