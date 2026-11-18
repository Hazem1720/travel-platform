import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '../../common/constants/currencies';
import { BudgetCategory } from '../schemas/itinerary.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// ITN-14: a non-negative budget entry for a day, in a selected currency.
export class CreateBudgetDto {
  @ApiProperty({ enum: BudgetCategory, example: BudgetCategory.FOOD })
  @IsEnum(BudgetCategory)
  category: BudgetCategory;

  @ApiProperty({ example: 400, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0)
  amount: number;

  @ApiProperty({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @Transform(upper)
  @IsSupportedCurrency()
  currency: string;

  @ApiPropertyOptional({ example: 'Lunch and dinner', maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto) {}
