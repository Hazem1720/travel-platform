import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// HTL-03: a hotel moderator adds an individually bookable room. Bookable date
// ranges are added separately (HTL-04).
export class CreateRoomDto {
  @ApiProperty({
    example: '101',
    maxLength: 50,
    description: 'Room number or name, unique within the hotel',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiProperty({ example: 'Double', maxLength: 50 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  beds: number;

  @ApiProperty({ example: 3, minimum: 1, description: 'At least 1' })
  @IsInt()
  @Min(1)
  maxOccupancy: number;

  @ApiProperty({
    example: 12000,
    minimum: 1,
    description: 'Price per night in USD cents, greater than 0',
  })
  @IsInt()
  @Min(1)
  pricePerNight: number;
}
