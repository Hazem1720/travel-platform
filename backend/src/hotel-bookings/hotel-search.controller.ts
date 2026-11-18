import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import {
  HotelSearchPageDto,
  HotelSearchQueryDto,
} from './dto/hotel-search.dto';
import { HotelSearchService } from './hotel-search.service';

// GET /hotels/search must be registered before Rawda's GET /hotels/:id, so
// HotelBookingsModule is imported before HotelsModule in app.module.ts.
@ApiTags('Hotels')
@Controller('hotels')
export class HotelSearchController {
  constructor(private readonly search: HotelSearchService) {}

  @Get('search')
  @Public()
  @ApiOperation({
    summary:
      'Search hotels by city or country, dates, guests and rooms (HTL-11)',
    description:
      'Lists active hotels with at least `rooms` rooms free for every night ' +
      'from checkIn up to checkOut whose largest occupancies cover `guests`. ' +
      'A room is free when it is active, bookable on every night and has no ' +
      'booking, block or unexpired hold. Cheapest first. Prices are in USD ' +
      'cents. No login needed.',
  })
  @ApiOkResponse({
    type: HotelSearchPageDto,
    description: 'One page of hotels',
  })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { checkIn: ['checkIn cannot be in the past'] },
    description:
      'checkOut not after checkIn, checkIn in the past, no city or country, ' +
      'an unknown city or country, or guests or rooms below 1',
  })
  find(@Query() q: HotelSearchQueryDto) {
    return this.search.searchPage(q);
  }
}
