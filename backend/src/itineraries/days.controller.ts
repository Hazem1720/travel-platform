import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
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
import { DAY_NOT_FOUND, DaysService, TOO_MANY_DAYS } from './days.service';
import { CreateDayDto, UpdateDayDto } from './dto/day.dto';
import { ItineraryDto } from './dto/itinerary.dto';
import { ID_PARAM, NOT_A_USER, NOT_FOUND } from './itineraries.controller';

export const DAY_PARAM = { name: 'dayId', example: '6735a1f4c1a2b3c4d5e6fa01' };
export const DAY_NOT_FOUND_ERROR = {
  status: 404,
  message: DAY_NOT_FOUND,
  description:
    "No such day in this itinerary, or the itinerary is another user's",
};

// ITN-05, ITN-07, ITN-08: the days of one of my itineraries.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('itineraries/:id/days')
export class DaysController {
  constructor(private readonly days: DaysService) {}

  @Post()
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Add a day at the end of my itinerary, at most 60 (ITN-05)',
  })
  @ApiCreatedResponse({
    type: ItineraryDto,
    description: 'The itinerary with numbered, dated days',
  })
  @ApiErrors(
    {
      status: 400,
      message: TOO_MANY_DAYS,
      description: 'A 61st day, an unknown or missing city, or a bad id',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    NOT_FOUND,
  )
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateDayDto,
  ) {
    return this.days.addDay(user, id, dto);
  }

  @Patch(':dayId')
  @ApiParam(ID_PARAM)
  @ApiParam(DAY_PARAM)
  @ApiOperation({ summary: "Change a day's city or notes (ITN-05)" })
  @ApiOkResponse({ type: ItineraryDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { cityId: ['Unknown city: atlantis'] },
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    DAY_NOT_FOUND_ERROR,
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: UpdateDayDto,
  ) {
    return this.days.updateDay(user, id, dayId, dto);
  }
}
