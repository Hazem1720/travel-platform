import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

// FLT-05: the price and the seat count of a cabin. The seat count cannot go
// below the seats already booked or held. A new price never changes existing
// bookings: they keep their price snapshot.
export class UpdateCabinDto {
  @ApiPropertyOptional({ example: 27000, description: 'USD cents, > 0' })
  @IsOptional()
  @IsInt()
  @Min(1)
  price?: number;

  @ApiPropertyOptional({ example: 140, description: 'Whole number > 0' })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalSeats?: number;
}
