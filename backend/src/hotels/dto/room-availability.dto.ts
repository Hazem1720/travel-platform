import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { AvailabilityRangeDto } from './availability-range.dto';
import { IsDateOnly } from './date-only';

export const MAX_RANGES_PER_ROOM = 50;

// PATCH /hotels/:id/rooms/:roomId/availability. Send exactly one of the three:
// - ranges (HTL-05): the room's new list of bookable ranges, replacing the old
//   one. Changing, shortening or removing a range is refused (409) if a night
//   that is no longer covered has a Confirmed or PendingPayment reservation.
// - block (HTL-06): blocks every night in [from, to). Refused (409) if any of
//   those nights is held, booked or already blocked; nothing is blocked then.
// - unblock (HTL-06): removes the Blocked nights in [from, to).
export class UpdateRoomAvailabilityDto {
  @ApiPropertyOptional({
    type: [AvailabilityRangeDto],
    example: [{ from: '2026-12-01', to: '2027-01-01' }],
    description:
      'HTL-05: the full new list of bookable ranges (an empty list removes ' +
      'them all). Ranges may touch but not overlap.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_RANGES_PER_ROOM)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRangeDto)
  ranges?: AvailabilityRangeDto[];

  @ApiPropertyOptional({
    type: AvailabilityRangeDto,
    example: { from: '2026-12-10', to: '2026-12-13' },
    description:
      'HTL-06: block the nights from `from` up to, not including, `to`',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AvailabilityRangeDto)
  block?: AvailabilityRangeDto;

  @ApiPropertyOptional({
    type: AvailabilityRangeDto,
    example: { from: '2026-12-10', to: '2026-12-13' },
    description: 'HTL-06: unblock the blocked nights in this range',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AvailabilityRangeDto)
  unblock?: AvailabilityRangeDto;
}

// Longest window HTL-08 shows in one call, so the answer stays small.
export const MAX_CALENDAR_NIGHTS = 31;

// GET /hotels/:id/availability?from&to (HTL-08). Rooms are paginated, 10 per
// page, sorted by name.
export class HotelCalendarQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: '2026-12-01', description: 'First night shown' })
  @IsDateOnly()
  from: string;

  @ApiProperty({
    example: '2026-12-15',
    description: `The day after the last night shown, at most ${MAX_CALENDAR_NIGHTS} nights after from`,
  })
  @IsDateOnly()
  to: string;
}

// Response shapes, used only for Swagger documentation.
export enum RoomNightStatus {
  AVAILABLE = 'Available',
  BOOKED = 'Booked',
  BLOCKED = 'Blocked',
  // Outside every bookable range of the room, or the room is deactivated.
  UNAVAILABLE = 'Unavailable',
}

export class RoomNightDto {
  @ApiProperty({ example: '2026-12-10' })
  date: string;

  @ApiProperty({ enum: RoomNightStatus, example: RoomNightStatus.BOOKED })
  status: RoomNightStatus;

  @ApiPropertyOptional({
    example: 'HT-7K2M9QXA',
    nullable: true,
    description:
      'Booked only: the reservation reference (null while the reservation ' +
      'is still PendingPayment)',
  })
  reference?: string | null;

  @ApiPropertyOptional({
    example: '6735a1f4c1a2b3c4d5e6fa01',
    description: 'Booked only: the reservation id',
  })
  bookingId?: string;

  @ApiPropertyOptional({
    example: 'Confirmed',
    description: 'Booked only: Confirmed, or PendingPayment during the hold',
  })
  bookingStatus?: string;
}

export class RoomCalendarDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  id: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ type: [RoomNightDto] })
  nights: RoomNightDto[];
}

class CalendarMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class HotelCalendarDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' })
  hotelId: string;

  @ApiProperty({ example: '2026-12-01' })
  from: string;

  @ApiProperty({ example: '2026-12-15' })
  to: string;

  @ApiProperty({ type: [RoomCalendarDto] })
  data: RoomCalendarDto[];

  @ApiProperty({ type: CalendarMetaDto })
  meta: CalendarMetaDto;
}

export class RoomBlockResultDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  roomId: string;

  @ApiProperty({ example: '2026-12-10' })
  from: string;

  @ApiProperty({ example: '2026-12-13' })
  to: string;

  @ApiProperty({
    example: 3,
    description: 'How many nights were blocked or unblocked',
  })
  nights: number;
}
