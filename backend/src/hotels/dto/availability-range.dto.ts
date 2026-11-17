import { ApiProperty } from '@nestjs/swagger';
import { IsDateOnly } from './date-only';

// HTL-04: a bookable range as whole dates. `from` is the first night and `to`
// is the day after the last night; `to` must be after `from`.
export class AvailabilityRangeDto {
  @ApiProperty({ example: '2026-12-01', description: 'First bookable night' })
  @IsDateOnly()
  from: string;

  @ApiProperty({
    example: '2027-01-01',
    description: 'The day after the last bookable night',
  })
  @IsDateOnly()
  to: string;
}
