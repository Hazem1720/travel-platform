import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Sara Ali' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'EGP', description: '3-letter currency code' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'preferredCurrency must be a 3-letter uppercase code' })
  preferredCurrency?: string;
}