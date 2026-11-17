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
  @ApiOkResponse({ description: 'The itinerary, its author and budget' })
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
