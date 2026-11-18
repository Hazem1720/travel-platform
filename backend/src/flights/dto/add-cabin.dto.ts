import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsPositive, Min } from 'class-validator';
import { CabinCategory } from '../schemas/flight.schema';

// FLT-04: a cabin category of the flight. bookedSeats and heldSeats are not
// fields here: they start at 0 and only the booking code changes them.
export class AddCabinDto {
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  @IsEnum(CabinCategory, {
    message: `category must be one of: ${Object.values(CabinCategory).join(', ')}`,
  })
  category: CabinCategory;

  @ApiProperty({ example: 150, minimum: 1, description: 'Whole number > 0' })
  @IsInt()
  @Min(1)
  totalSeats: number;

  @ApiProperty({
    example: 25000,
    minimum: 1,
    description: 'Price per seat in USD cents, > 0',
  })
  @IsInt()
  @Min(1)
  price: number;

  @ApiProperty({ example: 1, minimum: 0, description: 'Free bags (count)' })
  @IsInt()
  @Min(0)
  freeBags: number;

  @ApiProperty({ example: 23, description: 'Maximum kg per bag, > 0' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @IsPositive()
  maxKgPerBag: number;
}
