import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PublicSearchQueryDto } from './dto/public-search.dto';
import { BAD_ID, ID_PARAM } from './itineraries.controller';
import { ITINERARY_NOT_FOUND } from './itineraries.service';
import {
  PublicItinerariesService,
  PublicItineraryView,
} from './public-itineraries.service';
import { ApiErrors } from '../common/swagger/api-error.decorator';

const SEARCH_EXAMPLE = {
  data: [
    {
      _id: '6735a1f4c1a2b3c4d5e6f901',
      title: 'TEST Egypt in winter',
      countries: ['EG'],
      startDate: '2026-12-01T00:00:00.000Z',
      dayCount: 4,
      cities: ['cairo', 'luxor'],
      author: { id: '6735a1f4c1a2b3c4d5e6f001', name: 'Ziad' },
      updatedAt: '2026-11-17T10:00:00.000Z',
    },
  ],
  meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
};

// A real response from GET /itineraries/public/:id (budget amounts stay in
// each entry's own currency here; ITN-18 converts them for the owner).
const NONE = {
  food: {},
  accommodation: {},
  in_city_transport: {},
  activities: {},
  intercity_transport: {},
};
const VIEW_EXAMPLE = {
  _id: '6735a1f4c1a2b3c4d5e6f901',
  ownerId: '6735a1f4c1a2b3c4d5e6f001',
  title: 'Cairo and Dubai in 2 days',
  countries: ['EG', 'AE'],
  startDate: '2026-12-01T00:00:00.000Z',
  visibility: 'Public',
  hidden: false,
  clonedFrom: null,
  days: [
    {
      _id: '6735a1f4c1a2b3c4d5e6fa01',
      number: 1,
      date: '2026-12-01T00:00:00.000Z',
      cityId: 'cairo',
      notes: 'Pyramids day',
      activities: [
        {
          _id: '6735a1f4c1a2b3c4d5e6fb01',
          name: 'Giza Pyramids',
          description: '',
          time: '09:00',
          cost: { amount: 30, currency: 'USD' },
          images: [],
        },
      ],
      budgets: [
        {
          _id: '6735a1f4c1a2b3c4d5e6fc01',
          category: 'food',
          amount: 400,
          currency: 'EGP',
          note: '',
        },
      ],
    },
    {
      _id: '6735a1f4c1a2b3c4d5e6fa02',
      number: 2,
      date: '2026-12-02T00:00:00.000Z',
      cityId: 'dubai',
      notes: '',
      activities: [],
      budgets: [],
    },
  ],
  transportCosts: [],
  cityGroups: [
    {
      cityId: 'cairo',
      fromDay: 1,
      toDay: 1,
      dayCount: 1,
      budgetSubtotal: { EGP: 400, USD: 30 },
    },
    { cityId: 'dubai', fromDay: 2, toDay: 2, dayCount: 1, budgetSubtotal: {} },
  ],
  author: { id: '6735a1f4c1a2b3c4d5e6f001', name: 'Ziad' },
  budget: {
    total: { EGP: 400, USD: 30 },
    byCategory: { ...NONE, food: { EGP: 400 }, activities: { USD: 30 } },
    byDay: [
      {
        dayId: '6735a1f4c1a2b3c4d5e6fa01',
        number: 1,
        date: '2026-12-01T00:00:00.000Z',
        cityId: 'cairo',
        total: { EGP: 400, USD: 30 },
        byCategory: { ...NONE, food: { EGP: 400 }, activities: { USD: 30 } },
      },
      {
        dayId: '6735a1f4c1a2b3c4d5e6fa02',
        number: 2,
        date: '2026-12-02T00:00:00.000Z',
        cityId: 'dubai',
        total: {},
        byCategory: NONE,
      },
    ],
    cityGroups: [
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 1,
        dayCount: 1,
        budgetSubtotal: { EGP: 400, USD: 30 },
      },
      {
        cityId: 'dubai',
        fromDay: 2,
        toDay: 2,
        dayCount: 1,
        budgetSubtotal: {},
      },
    ],
  },
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:05:00.000Z',
};

// ITN-21: shared itineraries, open to guests. Registered before
// ItinerariesController (module order) so "public" is never read as an :id.
@ApiTags('Itineraries')
@Controller('itineraries/public')
export class PublicItinerariesController {
  constructor(private readonly publicItineraries: PublicItinerariesService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Search public itineraries by keyword, duration, country or city (ITN-21)',
  })
  @ApiOkResponse({ schema: { example: SEARCH_EXAMPLE } })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { minDays: ['minDays must not be above maxDays'] },
  })
  search(@Query() q: PublicSearchQueryDto) {
    return this.publicItineraries.search(q);
  }

  @Get(':id')
  @Public()
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      'View a public itinerary read-only, with author, days, activities and budget (ITN-21)',
  })
  @ApiOkResponse({
    description: 'The itinerary, its author and budget',
    schema: { example: VIEW_EXAMPLE },
  })
  @ApiErrors(BAD_ID, {
    status: 404,
    message: ITINERARY_NOT_FOUND,
    description:
      'No such itinerary, or it is Private, hidden or by a deactivated user',
  })
  view(@Param('id') id: string): Promise<PublicItineraryView> {
    return this.publicItineraries.view(id);
  }
}
