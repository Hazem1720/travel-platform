import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
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
  BUDGET_DELETED,
  BUDGET_NOT_FOUND,
  BudgetsService,
} from './budgets.service';
import { DAY_NOT_FOUND_ERROR, DAY_PARAM } from './days.controller';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';
import { ID_PARAM, NOT_A_USER, NOT_FOUND } from './itineraries.controller';

const ENTRY_PARAM = {
  name: 'id',
  example: '6735a1f4c1a2b3c4d5e6fd01',
  description: 'Budget entry id',
};
const ENTRY_NOT_FOUND = {
  status: 404,
  message: BUDGET_NOT_FOUND,
  description: "No such entry, or it is in another user's itinerary",
};
const BAD_ENTRY = {
  status: 400,
  message: 'Validation failed',
  details: { amount: ['amount must not be less than 0'] },
  description: 'A negative amount, an unknown category or currency',
};
const ENTRY_EXAMPLE = {
  _id: '6735a1f4c1a2b3c4d5e6fd01',
  itineraryId: '6735a1f4c1a2b3c4d5e6f901',
  dayId: '6735a1f4c1a2b3c4d5e6fa01',
  category: 'food',
  amount: 400,
  currency: 'EGP',
  note: 'Lunch and dinner',
};
const ORIGINAL_EXAMPLE = {
  total: { EGP: 1600, USD: 20 },
  byCategory: {
    food: { EGP: 400 },
    accommodation: { USD: 20 },
    in_city_transport: {},
    activities: { EGP: 300 },
    intercity_transport: { EGP: 900 },
  },
  byDay: [
    {
      dayId: '6735a1f4c1a2b3c4d5e6fa01',
      number: 1,
      date: '2026-12-01T00:00:00.000Z',
      cityId: 'cairo',
      total: { EGP: 700, USD: 20 },
      byCategory: {
        food: { EGP: 400 },
        accommodation: { USD: 20 },
        in_city_transport: {},
        activities: { EGP: 300 },
        intercity_transport: {},
      },
    },
  ],
  cityGroups: [
    {
      cityId: 'cairo',
      fromDay: 1,
      toDay: 1,
      dayCount: 1,
      budgetSubtotal: { EGP: 700, USD: 20 },
    },
  ],
};

export const SUMMARY_EXAMPLE = {
  currency: 'EGP',
  rateDate: '2026-11-17',
  ratesAreOld: false,
  total: 2580,
  byCategory: {
    food: 400,
    accommodation: 980,
    in_city_transport: 0,
    activities: 300,
    intercity_transport: 900,
  },
  byDay: [
    {
      dayId: '6735a1f4c1a2b3c4d5e6fa01',
      number: 1,
      date: '2026-12-01T00:00:00.000Z',
      cityId: 'cairo',
      total: 1680,
      byCategory: {
        food: 400,
        accommodation: 980,
        in_city_transport: 0,
        activities: 300,
        intercity_transport: 0,
      },
    },
  ],
  cityGroups: [
    {
      cityId: 'cairo',
      fromDay: 1,
      toDay: 1,
      dayCount: 1,
      budgetSubtotal: 1680,
    },
  ],
  original: ORIGINAL_EXAMPLE,
};

// ITN-14: budget entries for the days of my itinerary, and its summary.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post('itineraries/:id/days/:dayId/budgets')
  @ApiParam(ID_PARAM)
  @ApiParam(DAY_PARAM)
  @ApiOperation({ summary: 'Add a budget entry to a day (ITN-14)' })
  @ApiCreatedResponse({ schema: { example: ENTRY_EXAMPLE } })
  @ApiErrors(BAD_ENTRY, UNAUTHENTICATED, NOT_A_USER, DAY_NOT_FOUND_ERROR)
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('dayId') dayId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgets.add(user, id, dayId, dto);
  }

  @Patch('budgets/:id')
  @ApiParam(ENTRY_PARAM)
  @ApiOperation({ summary: 'Edit a budget entry (ITN-14)' })
  @ApiOkResponse({ schema: { example: ENTRY_EXAMPLE } })
  @ApiErrors(BAD_ENTRY, UNAUTHENTICATED, NOT_A_USER, ENTRY_NOT_FOUND)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgets.update(user, id, dto);
  }

  @Delete('budgets/:id')
  @ApiParam(ENTRY_PARAM)
  @ApiOperation({ summary: 'Delete a budget entry (ITN-14)' })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: BUDGET_DELETED } },
  })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, ENTRY_NOT_FOUND)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.budgets.remove(user, id);
  }

  @Get('itineraries/:id/budget-summary')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      'Budget totals by category and by day, with activity costs and ' +
      "intercity transport (ITN-14), in my preferred currency with the rate's date (ITN-18)",
    description:
      'Amounts are converted with exchange rates fetched once a day from ' +
      'FXRatesAPI and cached. If the API is down, the last cached rates are ' +
      'used (ratesAreOld: true and an older rateDate). `original` gives the ' +
      "totals in the entries' own currencies. Booking prices are never " +
      'converted (PAY-04).',
  })
  @ApiOkResponse({ schema: { example: SUMMARY_EXAMPLE } })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, NOT_FOUND, {
    status: 503,
    message:
      'Exchange rates are unavailable right now and none are cached yet, please try again later',
    description: 'FXRatesAPI is unavailable and no rates were ever cached',
  })
  summary(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.budgets.summary(user, id);
  }
}
