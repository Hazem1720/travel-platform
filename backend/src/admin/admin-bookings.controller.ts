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
import { BAD_DATE_RANGE, AdminBookingsService } from './admin-bookings.service';
import {
  AdminBookingsPageDto,
  AdminBookingsQueryDto,
} from './dto/admin-bookings.dto';

// Hasan's part of src/admin: ACC-17, every booking on the platform.
@ApiTags('Admin')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'All flight and hotel bookings, read-only (ACC-17)',
    description:
      'Every booking with its reference, user, provider (airline or ' +
      'hotel), travel dates, amount and status, newest first, 10 per page. ' +
      'Filter by type (flight or hotel), status, and a travel date range ' +
      '(from/to: flight departure or hotel check-in).',
  })
  @ApiOkResponse({ type: AdminBookingsPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        type: ['type must be one of the following values: flight, hotel'],
      },
      description: `Unknown type or status, a date not YYYY-MM-DD, or "${BAD_DATE_RANGE}"`,
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not an admin',
    },
  )
  list(@Query() query: AdminBookingsQueryDto) {
    return this.bookings.list(query);
  }
}
