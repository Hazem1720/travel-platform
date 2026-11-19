import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
} from 'class-validator';
import { ReportTargetType } from '../schemas/report.schema';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.POST })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiProperty({ example: '6736e5f4c1a2b3c4d5e6fc01' })
  @IsString()
  @IsMongoId()
  targetId: string;

  @ApiProperty({ example: 'This content is inappropriate.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, {
    message: 'Reason cannot contain only whitespace',
  })
  reason: string;
}
