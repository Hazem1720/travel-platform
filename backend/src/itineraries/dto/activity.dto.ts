import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MoneyDto } from './money.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ITN-10: an activity on a day.
export class CreateActivityDto {
  @ApiProperty({ example: 'Visit the Egyptian Museum', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Tickets at the gate', maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    example: '10:30',
    nullable: true,
    description: 'HH:mm, 24-hour',
  })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time must be written as HH:mm (24-hour)',
  })
  time?: string | null;

  @ApiPropertyOptional({ type: MoneyDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDto)
  cost?: MoneyDto | null;
}

// ITN-10: every field optional; time or cost set to null removes it.
export class UpdateActivityDto extends PartialType(CreateActivityDto) {}
