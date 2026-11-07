import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  IsSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '../../common/constants/currencies';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Sara Ali' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '+20 100 123 4567' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{7,20}$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  // ACC-09, GEN-12: only the supported currencies.
  @ApiPropertyOptional({ example: 'EGP', enum: SUPPORTED_CURRENCIES })
  @IsOptional()
  @IsSupportedCurrency()
  preferredCurrency?: string;
}