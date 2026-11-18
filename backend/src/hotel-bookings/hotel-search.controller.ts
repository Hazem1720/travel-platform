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
      'Search hotels by city or country, dates, guests and rooms; filter by price and rating and sort (HTL-11, HTL-12)',
    description:
      'Lists active hotels with at least `rooms` rooms free for every night ' +
      'from checkIn up to checkOut whose largest occupancies cover `guests`. ' +
      'A room is free when it is active, bookable on every night and has no ' +
      'booking, block or unexpired hold. Prices are in USD cents. No login ' +
      'needed. HTL-12: ?minPrice and ?maxPrice (inclusive) apply to ' +
      'fromPricePerNight, the price per night of the cheapest free room; ' +
      '?minRating (1-5) keeps hotels whose average rating is at least that ' +
      'and leaves out unrated hotels; ?sort=price or rating, with :asc or ' +
      ':desc (default price:asc). The other criteria stay applied.',
  })
  @ApiOkResponse({
    type: HotelSearchPageDto,
    description: 'One page of hotels',
  })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { minPrice: ['minPrice cannot be greater than maxPrice'] },
    description:
      'checkOut not after checkIn, checkIn in the past, no city or country, ' +
      'an unknown city or country, guests or rooms below 1, minPrice above ' +
      'maxPrice, minRating outside 1-5, or an unknown sort',
  })
  find(@Query() q: HotelSearchQueryDto) {
    return this.search.searchPage(q);
  }
}
