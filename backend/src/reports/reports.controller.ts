import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { CreateReportDto } from './dto/create-report.dto';
import { HideContentDto } from './dto/hide-content.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiCookieAuth('access_token')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Report a post, comment, review or itinerary (GEN-09)',
  })
  @ApiCreatedResponse({
    description: 'Report created',
    schema: {
      example: {
        _id: '6736e5f4c1a2b3c4d5e6fc01',
        targetType: 'post',
        targetId: '6736e5f4c1a2b3c4d5e6fc02',
        reason: 'Inappropriate content',
        status: 'open',
      },
    },
  })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    UNAUTHENTICATED,
    { status: 404, message: 'Reported content not found' },
    { status: 409, message: 'You have already reported this item' },
  )
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }
}

@ApiTags('Admin: reports and moderation')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @ApiOperation({ summary: 'List open content reports, admin only (GEN-10)' })
  @ApiOkResponse({
    description: 'Paginated open reports',
    schema: {
      example: {
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
    },
  })
  @ApiErrors({ status: 400, message: 'Validation failed' }, UNAUTHENTICATED, {
    status: 403,
    message: 'You do not have permission for this action',
  })
  list(@Query() q: PaginationQueryDto) {
    return this.reports.listOpen(q);
  }

  @Patch('reports/:id')
  @ApiParam({ name: 'id', example: '6736e5f4c1a2b3c4d5e6fc01' })
  @ApiOperation({
    summary: 'Dismiss, hide or delete reported content (GEN-10)',
  })
  @ApiOkResponse({
    description: 'Report resolved',
    schema: {
      example: { _id: '6736e5f4c1a2b3c4d5e6fc01', status: 'resolved' },
    },
  })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    UNAUTHENTICATED,
    { status: 403, message: 'You do not have permission for this action' },
    { status: 404, message: 'Open report not found' },
  )
  resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(admin, id, dto);
  }

  @Delete('content/:type/:id')
  @ApiOperation({
    summary: 'Delete a post, comment, review or itinerary directly (GEN-10)',
  })
  @ApiOkResponse({
    description: 'Content deleted',
    schema: {
      example: {
        success: true,
        action: 'delete',
        targetType: 'post',
        targetId: '6736e5f4c1a2b3c4d5e6fc01',
      },
    },
  })
  @ApiErrors(
    { status: 400, message: 'Unsupported content type or invalid id' },
    UNAUTHENTICATED,
    { status: 403, message: 'You do not have permission for this action' },
    { status: 404, message: 'Content not found' },
  )
  delete(
    @CurrentUser() admin: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.reports.moderateContent(admin, type, id, 'delete');
  }

  @Patch('content/:type/:id/hide')
  @ApiOperation({
    summary: 'Hide or unhide content directly (GEN-10; suggested endpoint)',
  })
  @ApiOkResponse({
    description: 'Visibility updated',
    schema: { example: { success: true, hidden: true } },
  })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    UNAUTHENTICATED,
    { status: 403, message: 'You do not have permission for this action' },
    { status: 404, message: 'Content not found' },
  )
  hide(
    @CurrentUser() admin: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: HideContentDto,
  ) {
    return this.reports.hideContent(admin, type, id, dto.hidden);
  }
}
