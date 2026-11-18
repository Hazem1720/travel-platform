import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

// FLT-08: price per extra bag and the most extra bags per passenger. An
// extra bag has the same weight limit as the cabin's free bags
// (maxKgPerBag), so there is no weight field here.
export class BaggagePolicyDto {
  @ApiProperty({
    example: 3000,
    minimum: 1,
    description: 'Price per extra bag in USD cents, > 0',
  })
  @IsInt()
  @Min(1)
  extraBagPrice: number;

  @ApiProperty({ example: 2, minimum: 0, description: 'Whole number >= 0' })
  @IsInt()
  @Min(0)
  maxExtraBags: number;
}
