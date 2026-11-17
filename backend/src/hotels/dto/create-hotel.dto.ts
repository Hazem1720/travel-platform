import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v.trim() : v))
    : value;

// HTL-01: the admin creates the hotel profile. Photos are uploaded through
// their own routes (GEN-08); isActive, check-in/out times and cancellation
// tiers have their own routes (ACC-15, HTL-09, HTL-10).
export class CreateHotelDto {
  @ApiProperty({ example: 'TEST Nile View Hotel', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil St', maxLength: 250 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  address: string;

  @ApiProperty({
    example: 'cairo',
    description: 'A seeded city id, such as cairo or new_york',
  })
  @Transform(trimLower)
  @IsString()
  @IsNotEmpty()
  cityId: string;

  @ApiProperty({
    example: 'EG',
    description: 'The country code of that city, such as EG',
  })
  @Transform(trimUpper)
  @IsString()
  @IsNotEmpty()
  countryCode: string;

  @ApiPropertyOptional({ example: 'A quiet riverside hotel.', maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  starClass: number;

  @ApiPropertyOptional({ type: [String], example: ['wifi', 'pool'] })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(50, { each: true })
  amenities?: string[];
}
