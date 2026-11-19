import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

// HTL-05 (beds, occupancy, price) and HTL-06 (isActive=false deactivates the
// room, true reactivates it). Every field is optional; only the ones sent
// change. The name and the bookable ranges are not edited here: ranges have
// their own route (PATCH .../availability).
export class UpdateRoomDto {
  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  beds?: number;

  @ApiPropertyOptional({ example: 3, minimum: 1, description: 'At least 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxOccupancy?: number;

  @ApiPropertyOptional({
    example: 15000,
    minimum: 1,
    description:
      'Price per night in USD cents, greater than 0. Existing reservations ' +
      'keep the price they were booked at.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  pricePerNight?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'false deactivates the room (hidden from search; refused while a ' +
      'Confirmed or PendingPayment reservation covers a future night), ' +
      'true reactivates it',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
