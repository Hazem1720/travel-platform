import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CabinCategory, PassengerType } from '../flight-booking.rules';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ExtraBagDto {
  @ApiProperty({
    example: 23,
    description: "Kg, up to the cabin's maxKgPerBag",
  })
  @IsInt()
  @Min(1)
  weightKg: number;
}

// FLT-19: one passenger.
export class PassengerDto {
  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  @IsEnum(PassengerType)
  type: PassengerType;

  @ApiProperty({ example: 'Sara Ali' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({
    example: '1995-04-17',
    description: 'Must match the type on the departure date',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must look like 1995-04-17',
  })
  @IsISO8601({ strict: true }, { message: 'dateOfBirth must be a real date' })
  dateOfBirth: string;

  @ApiProperty({ example: 'A12345678', description: 'Passport or ID number' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{5,20}$/, {
    message: 'passportNumber must be 5-20 letters or digits',
  })
  passportNumber: string;

  @ApiPropertyOptional({
    type: [ExtraBagDto],
    example: [{ weightKg: 23 }],
    description: "Extra bags, up to the airline's maxExtraBags",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraBagDto)
  extraBags?: ExtraBagDto[];
}

// POST /api/flight-bookings (quote, FLT-19 and FLT-21) and
// POST /api/flight-bookings/hold (FLT-22) take the same body.
export class FlightQuoteDto {
  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f101' })
  @IsMongoId()
  outboundFlightId: string;

  @ApiPropertyOptional({
    example: '6737a1f4c1a2b3c4d5e6f102',
    description: 'Round trip: the return flight (FLT-12)',
  })
  @IsOptional()
  @IsMongoId()
  returnFlightId?: string;

  @ApiProperty({
    enum: CabinCategory,
    example: CabinCategory.ECONOMY,
    description: 'The same cabin on both flights of a round trip',
  })
  @IsEnum(CabinCategory)
  cabin: CabinCategory;

  @ApiProperty({ type: [PassengerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers: PassengerDto[];
}
