import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
} from 'class-validator';
import {
  IsSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '../../common/constants/currencies';
import { TransportMode } from '../schemas/itinerary.schema';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// ITN-16: an intercity transport cost on a day of the itinerary.
export class CreateTransportCostDto {
  @ApiProperty({ enum: TransportMode, example: TransportMode.TRAIN })
  @IsEnum(TransportMode)
  mode: TransportMode;

  @ApiProperty({ example: 'cairo', description: 'A seeded city id' })
  @Transform(trimLower)
  @IsString()
  @IsNotEmpty()
  fromCityId: string;

  @ApiProperty({ example: 'luxor', description: 'A seeded city id' })
  @Transform(trimLower)
  @IsString()
  @IsNotEmpty()
  toCityId: string;

  @ApiProperty({ example: 900, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @Transform(upper)
  @IsSupportedCurrency()
  currency: string;

  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6fa03',
    description: 'A day of this itinerary',
  })
  @IsMongoId()
  dayId: string;
}

export class UpdateTransportCostDto extends PartialType(
  CreateTransportCostDto,
) {}
