import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import { FlightDetailsDto } from './dto/flight-details.dto';
import { FlightSearchResultDto } from './dto/flight-search-result.dto';
import { FlightDetailsService } from './flight-details.service';
import { FlightSearchService } from './flight-search.service';

// FLT-11, FLT-12, FLT-15 (search) and FLT-17 (details). Public: guests
// search too. GET /flights/:id is declared after GET /flights/search, so
// "search" is never read as an id.
@ApiTags('Flights: search and details')
@Controller('flights')
export class FlightSearchController {
  constructor(
    private readonly search: FlightSearchService,
    private readonly flightDetails: FlightDetailsService,
  ) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Search flights, one way or round trip, filter and sort (FLT-11, FLT-12, FLT-15)',
    description:
      'Scheduled flights of active airlines from one airport to another on ' +
      'a local date at the departure airport, with enough free seats for ' +
      'the passengers (infants take no seat). Earliest first, 10 per page. ' +
      'Use ?passengers=N, or ?adults&children&infants. Optional ?cabin. ' +
      'Each cabin shows totalFare for the passengers (infants pay 10%). ' +
      'Round trip: add ?returnDate; returnFlights then lists the flights ' +
      'back (to -> from), otherwise it is null. ?page pages the outbound ' +
      'list and ?returnPage the flights back; flights back that leave ' +
      'before the earliest outbound arrival are left out. FLT-15: ?minPrice and ' +
      '?maxPrice (inclusive, USD cents) on lowestPrice, the chosen or ' +
      'cheapest cabin; ?sort=price|duration|departure with :asc or :desc ' +
      '(default departure:asc). No match: 200 with an empty list and ' +
      '"No flights found".',
  })
  @ApiOkResponse({ type: FlightSearchResultDto })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { minPrice: ['minPrice cannot be greater than maxPrice'] },
    description:
      'Unknown airport, same airport twice, invalid date, returnDate ' +
      'before date, minPrice above maxPrice, unknown sort, or passenger ' +
      'numbers (at least one adult, no more infants than adults)',
  })
  find(@Query() q: FlightSearchQueryDto) {
    return this.search.search(q);
  }

  @Get(':id')
  @Public()
  @ApiParam({ name: 'id', example: '6736d4f4c1a2b3c4d5e6fa01' })
  @ApiOperation({
    summary: 'Flight details (FLT-17)',
    description:
      'Airline, flight number, airports, local departure and arrival times ' +
      '(GEN-06), duration, every cabin with price, seats remaining (total - ' +
      'booked - held) and baggage allowance, the extra-bag policy and the ' +
      "airline's cancellation policy. Cancelled flights and flights of " +
      'inactive airlines answer 404.',
  })
  @ApiOkResponse({ type: FlightDetailsDto })
  @ApiErrors({
    status: 404,
    message: 'Flight not found',
    description: 'Unknown id, Cancelled flight or inactive airline',
  })
  details(@Param('id') id: string) {
    return this.flightDetails.details(id);
  }
}
