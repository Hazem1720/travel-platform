import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
export class HideContentDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  hidden: boolean;
}
