import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ResolveReportDto {
  @ApiProperty({ enum: ['dismiss', 'hide', 'delete'], example: 'hide' })
  @IsIn(['dismiss', 'hide', 'delete'])
  action: 'dismiss' | 'hide' | 'delete';
}
