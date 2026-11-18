import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';
import {
  IsSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '../../common/constants/currencies';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// ITN-10, ITN-14, ITN-16: a non-negative amount in a supported currency, in
// the currency's main unit with up to 2 decimals.
export class MoneyDto {
  @ApiProperty({ example: 250, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @Transform(upper)
  @IsSupportedCurrency()
  currency: string;
}
