import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { MessageDto } from '../auth/dto/auth-responses.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  ACTIVITY_DELETED,
  ACTIVITY_NOT_FOUND,
  ActivitiesService,
} from './activities.service';
import { DAY_NOT_FOUND_ERROR, DAY_PARAM } from './days.controller';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ActivityViewDto } from './dto/activity-view.dto';
import { ID_PARAM, NOT_A_USER } from './itineraries.controller';

export const ACTIVITY_PARAM = {
  name: 'id',
  example: '6735a1f4c1a2b3c4d5e6fb01',
  description: 'Activity id',
};
export const ACTIVITY_NOT_FOUND_ERROR = {
  status: 404,
  message: ACTIVITY_NOT_FOUND,
  description: "No such activity, or it is in another user's itinerary",
};
const BAD_ACTIVITY = {
  status: 400,
  message: 'Validation failed',
  details: {
    'cost.currency': [
      'currency must be one of: AED, EGP, EUR, GBP, JPY, SAR, USD',
    ],
  },
  description:
    'Missing name, time not HH:mm, a negative cost or an unsupported currency',
};

// ITN-10: add an activity to a day of my itinerary.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('itineraries/:id/days/:dayId/activities')
export class DayActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Post()
  @ApiParam(ID_PARAM)
  @ApiParam(DAY_PARAM)
  @ApiOperation({ summary: 'Add an activity to a day (ITN-10)' })
  @ApiCreatedResponse({ type: ActivityViewDto })
  @ApiErrors(BAD_ACTIVITY, UNAUTHENTICATED, NOT_A_USER, DAY_NOT_FOUND_ERROR)
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activities.add(user, id, dayId, dto);
  }
}

// ITN-10 (edit, delete) and ITN-12 (images), by activity id.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Patch(':id')
  @ApiParam(ACTIVITY_PARAM)
  @ApiOperation({ summary: 'Edit an activity in my itinerary (ITN-10)' })
  @ApiOkResponse({ type: ActivityViewDto })
  @ApiErrors(
    BAD_ACTIVITY,
    UNAUTHENTICATED,
    NOT_A_USER,
    ACTIVITY_NOT_FOUND_ERROR,
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activities.update(user, id, dto);
  }

  @Delete(':id')
  @ApiParam(ACTIVITY_PARAM)
  @ApiOperation({ summary: 'Delete an activity from my itinerary (ITN-10)' })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: ACTIVITY_DELETED } },
  })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, ACTIVITY_NOT_FOUND_ERROR)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.activities.remove(user, id);
  }
}
