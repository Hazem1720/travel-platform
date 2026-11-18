import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import { FlightSearchResultDto } from './dto/flight-search-result.dto';
import { FlightSearchService } from './flight-search.service';

// FLT-11. Public: guests search too. GET /flights/:id (FLT-17) will live in
// this controller as well, declared after search so "search" is not an id.
@ApiTags('Flights: search')
@Controller('flights')
export class FlightSearchController {
  constructor(private readonly search: FlightSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary: 'Search flights, one way or round trip (FLT-11, FLT-12)',
    description:
      'Scheduled flights of active airlines from one airport to another on ' +
      'a local date at the departure airport, with enough free seats for ' +
      'the passengers (infants take no seat). Earliest first, 10 per page. ' +
      'Use ?passengers=N, or ?adults&children&infants. Optional ?cabin. ' +
      'Each cabin shows totalFare for the passengers (infants pay 10%). ' +
      'Round trip: add ?returnDate; returnFlights then lists the flights ' +
      'back (to -> from), otherwise it is null. No match: 200 with an ' +
      'empty list and "No flights found".',
  })
  @ApiOkResponse({ type: FlightSearchResultDto })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { to: ['Departure and arrival airports must differ'] },
    description:
      'Unknown airport, same airport twice, invalid date or passenger ' +
      'numbers (at least one adult, no more infants than adults)',
  })
  find(@Query() q: FlightSearchQueryDto) {
    return this.search.search(q);
  }
}
