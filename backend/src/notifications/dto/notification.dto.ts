import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '../schemas/notification.schema';

// Response shapes, used only for Swagger documentation (GEN-01).

export class NotificationDto {
  @ApiProperty({ example: '6736b2f4c1a2b3c4d5e6f801' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' })
  userId: string;

  @ApiProperty({
    enum: NotificationType,
    example: NotificationType.BOOKING_CONFIRMED,
  })
  type: NotificationType;

  @ApiProperty({ example: 'Your flight booking FL-7K2M9QX4 is confirmed' })
  message: string;

  @ApiProperty({
    example: {
      bookingId: '6736b2f4c1a2b3c4d5e6f900',
      reference: 'FL-7K2M9QX4',
    },
    nullable: true,
    type: Object,
  })
  data: Record<string, unknown> | null;

  @ApiProperty({ example: null, nullable: true, type: Date })
  readAt: Date | null;

  @ApiProperty({ example: '2026-11-16T09:30:00.000Z' })
  createdAt: Date;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 11 }) total: number;
  @ApiProperty({ example: 2 }) totalPages: number;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] })
  data: NotificationDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  count: number;
}

export class MarkedReadDto {
  @ApiProperty({ example: 3, description: 'How many were unread before' })
  updated: number;
}
