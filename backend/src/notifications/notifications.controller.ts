import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  MarkedReadDto,
  NotificationDto,
  NotificationPageDto,
  UnreadCountDto,
} from './dto/notification.dto';
import {
  NOTIFICATION_NOT_FOUND,
  NotificationsService,
} from './notifications.service';

// GEN-01. Every role has notifications, so there is no @Roles() here: the
// global guard only requires a session.
@ApiTags('Notifications')
@ApiCookieAuth('access_token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'My notifications, newest first (GEN-01)',
    description: 'Paginated, 10 per page. readAt is null while unread.',
  })
  @ApiOkResponse({ type: NotificationPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { limit: ['limit must not be greater than 10'] },
    },
    UNAUTHENTICATED,
    MUST_CHANGE_PASSWORD,
  )
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    return this.notifications.list(user.id, q);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'How many of my notifications are unread (GEN-01)' })
  @ApiOkResponse({ type: UnreadCountDto })
  @ApiErrors(UNAUTHENTICATED, MUST_CHANGE_PASSWORD)
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read (GEN-01)' })
  @ApiOkResponse({ type: MarkedReadDto })
  @ApiErrors(UNAUTHENTICATED, MUST_CHANGE_PASSWORD)
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiParam({ name: 'id', example: '6736b2f4c1a2b3c4d5e6f801' })
  @ApiOperation({ summary: 'Mark one of my notifications as read (GEN-01)' })
  @ApiOkResponse({ type: NotificationDto, description: 'The notification' })
  @ApiErrors(
    {
      status: 400,
      message: 'Invalid value for "_id"',
      details: { _id: ['"abc" is not valid'] },
    },
    UNAUTHENTICATED,
    MUST_CHANGE_PASSWORD,
    {
      status: 404,
      message: NOTIFICATION_NOT_FOUND,
      description: "Unknown id, or another user's notification",
    },
  )
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }
}
