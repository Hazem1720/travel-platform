import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

// BON-01 (bonus): the admin analytics dashboard's data.
@ApiTags('Admin')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Bookings and revenue per provider over a period (BON-01)',
    description:
      'Bookings made from "from" to "to" (UTC days, both included; default ' +
      'the last 30 days), per airline and per hotel: Confirmed and ' +
      'Completed bookings, cancelled ones, what was paid (grossRevenue), ' +
      'refunds (refunded) and revenue = grossRevenue - refunded, in cents ' +
      'of the platform currency. A round trip with two airlines counts for ' +
      "both, each with its own segment's price.",
  })
  @ApiOkResponse({
    schema: {
      example: {
        from: '2026-11-01',
        to: '2026-11-30',
        currency: 'USD',
        totals: {
          bookings: 3,
          cancelled: 1,
          grossRevenue: 95000,
          refunded: 10000,
          revenue: 85000,
        },
        airlines: [
          {
            providerId: '6735a1f4c1a2b3c4d5e6f701',
            name: 'Nile Air',
            code: 'NP',
            bookings: 2,
            cancelled: 1,
            grossRevenue: 50000,
            refunded: 10000,
            revenue: 40000,
          },
        ],
        hotels: [
          {
            providerId: '6735a1f4c1a2b3c4d5e6f801',
            name: 'Nile View Hotel',
            bookings: 1,
            cancelled: 0,
            grossRevenue: 45000,
            refunded: 0,
            revenue: 45000,
          },
        ],
      },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: 'from must not be after to',
      description: 'Or a date that is not YYYY-MM-DD',
    },
    UNAUTHENTICATED,
    { status: 403, message: 'You do not have permission for this action' },
  )
  summary(@Query() q: AnalyticsQueryDto) {
    return this.analytics.summary(q);
  }
}
