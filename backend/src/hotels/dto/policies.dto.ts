import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, Matches, ValidateNested } from 'class-validator';
import {
  CancellationTierDto,
  UniqueDaysBefore,
} from '../../common/helpers/cancellation-tiers';

export const TIME_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_MESSAGE = (field: string) =>
  `${field} must be a 24-hour time written as HH:mm, such as 14:00`;

// HTL-09 and HTL-10: one route replaces the hotel's standard times and its
// cancellation tiers. An empty tier list is allowed: then every cancellation
// refunds 0%. The tier rules are the shared ones from Hazem (FLT-09).
export class HotelPoliciesDto {
  @ApiProperty({ example: '14:00', description: 'HH:mm, 24-hour' })
  @Matches(TIME_HH_MM, { message: TIME_MESSAGE('checkInTime') })
  checkInTime: string;

  @ApiProperty({ example: '12:00', description: 'HH:mm, 24-hour' })
  @Matches(TIME_HH_MM, { message: TIME_MESSAGE('checkOutTime') })
  checkOutTime: string;

  @ApiProperty({
    type: [CancellationTierDto],
    example: [
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  @UniqueDaysBefore()
  cancellationTiers: CancellationTierDto[];
}
