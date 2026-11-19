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
import { MessageDto } from '../auth/dto/auth-responses.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ItineraryDto, ItineraryListDto } from './dto/itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import {
  ITINERARY_DELETED,
  ITINERARY_NOT_FOUND,
  ItinerariesService,
} from './itineraries.service';
import { PublicItinerariesService } from './public-itineraries.service';
import {
  ItineraryFlightsQueryDto,
  ItineraryHotelsQueryDto,
} from './dto/itinerary-search.dto';
import { ItineraryFlightsService } from './itinerary-flights.service';
import { ItineraryHotelsService } from './itinerary-hotels.service';

export const ID_PARAM = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f901' };
export const NOT_FOUND = {
  status: 404,
  message: ITINERARY_NOT_FOUND,
  description: "No such itinerary, or it is another user's (ACC-11)",
};
export const NOT_A_USER = {
  status: 403,
  message: 'You do not have permission for this action',
  description:
    'Not a registered user (admins and moderators cannot plan trips), ' +
    `a suspended account, or "${MUST_CHANGE_PASSWORD.message}"`,
};
export const BAD_ID = {
  status: 400,
  message: 'Invalid value for "_id"',
  details: { _id: ['"abc" is not valid'] },
};

// Itineraries are planned by registered users only (project description,
// section 4), so every route here is @Roles(Role.USER).
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly publicItineraries: PublicItinerariesService,
    private readonly itineraryHotels: ItineraryHotelsService,
    private readonly itineraryFlights: ItineraryFlightsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an itinerary, Private by default (ITN-01)' })
  @ApiCreatedResponse({ type: ItineraryDto, description: 'The new itinerary' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { countries: ['Unknown country: XX'] },
      description:
        'Missing or too long title (over 100 characters), no countries, ' +
        'an unknown country code, or an invalid start date',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
  )
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateItineraryDto) {
    return this.itineraries.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List my itineraries, most recently updated first (ITN-03)',
  })
  @ApiOkResponse({ type: ItineraryListDto, description: 'One page of 10' })
  @ApiErrors(
    {
      status: 400,
      message: 'Cannot sort by "price". Allowed: updatedAt, title, startDate',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
  )
  listMine(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    return this.itineraries.listMine(user, q);
  }

  @Get(':id')
  @ApiParam(ID_PARAM)
  @ApiOperation({ summary: 'Open one of my itineraries (ITN-03)' })
  @ApiOkResponse({ type: ItineraryDto, description: 'The full itinerary' })
  @ApiErrors(BAD_ID, UNAUTHENTICATED, NOT_A_USER, NOT_FOUND)
  getMine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.itineraries.getMine(user, id);
  }

  @Patch(':id')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      "Edit your itinerary's title, countries or start date (ITN-01), " +
      'or set it Public or Private (ITN-20)',
  })
  @ApiOkResponse({ type: ItineraryDto, description: 'The updated itinerary' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        title: ['title must be shorter than or equal to 100 characters'],
      },
      description:
        'Invalid fields, an unknown country, or a malformed itinerary id',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    NOT_FOUND,
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateItineraryDto,
  ) {
    return this.itineraries.update(user, id, dto);
  }

  // The frontend asks for confirmation first (Milestone 2).
  @Delete(':id')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Delete your itinerary; clones made by others are kept (ITN-01)',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: ITINERARY_DELETED } },
  })
  @ApiErrors(BAD_ID, UNAUTHENTICATED, NOT_A_USER, NOT_FOUND)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.itineraries.remove(user, id);
  }

  @Post(':id/clone')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      'Clone a public itinerary into my own Private copy that credits the author (ITN-21)',
  })
  @ApiCreatedResponse({
    type: ItineraryDto,
    description: 'The new Private copy, with clonedFrom set',
  })
  @ApiErrors(BAD_ID, UNAUTHENTICATED, NOT_A_USER, {
    status: 404,
    message: ITINERARY_NOT_FOUND,
    description: 'No such itinerary, or it is not public',
  })
  clone(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.publicItineraries.clone(user, id);
  }

  @Get(':id/hotels')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      'Hotels available for one city group of my itinerary (ITN-25, reuses HTL-11)',
    description:
      "Check-in is the group's first day and check-out the day after its " +
      'last day. The hotels are those GET /hotels/search (HTL-11) returns ' +
      "for the group's city and dates. Prices are USD cents per night (PAY-04).",
  })
  @ApiOkResponse({
    schema: {
      example: {
        search: {
          cityId: 'luxor',
          checkIn: '2026-12-05',
          checkOut: '2026-12-07',
          guests: 2,
          rooms: 1,
          fromDay: 5,
          toDay: 6,
        },
        data: [
          {
            id: '6735a1f4c1a2b3c4d5e6f801',
            name: 'TEST Nile View Hotel',
            address: '1 Corniche El Nil',
            cityId: 'luxor',
            countryCode: 'EG',
            starClass: 4,
            images: [],
            amenities: ['wifi'],
            ratingAverage: 0,
            ratingCount: 0,
            checkInTime: '14:00',
            checkOutTime: '12:00',
            fromPricePerNight: 12000,
            freeRoomCount: 2,
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { groupIndex: ['groupIndex must be between 0 and 2'] },
      description:
        "No such group, more rooms than guests, or the group's check-in date is in the past",
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    NOT_FOUND,
  )
  hotels(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() q: ItineraryHotelsQueryDto,
  ) {
    return this.itineraryHotels.hotelsForGroup(user, id, q);
  }

  @Get(':id/flights')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      "Flights from an airport to the first day's city (ITN-26, reuses FLT-11 and FLT-12)",
    description:
      'Searches every airport in the city of the first day with the FLT-11 ' +
      'search (bookable flights of active airlines with enough seats). The ' +
      'outbound date defaults to the start date; with roundTrip=true (or a ' +
      "returnDate) the return defaults to the last day's date. Passengers " +
      '(adults, children, infants), cabin and sort work as in ' +
      'GET /api/flights/search; ?page pages the outbound flights and ' +
      '?returnPage the flights back.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        search: {
          origin: 'CAI',
          cityId: 'dubai',
          destinations: ['DXB'],
          date: '2026-12-01',
          returnDate: '2026-12-05',
          roundTrip: true,
        },
        data: [
          {
            _id: '6736e5f4c1a2b3c4d5e6f101',
            flightNumber: 'NP101',
            from: 'CAI',
            to: 'DXB',
            airline: { name: 'Nile Air', code: 'NP' },
            cabins: [{ category: 'Economy', price: 25000, totalFare: 25000 }],
            lowestPrice: 25000,
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
        message: null,
        returnFlights: {
          data: [],
          meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
          message: 'No flights found',
        },
      },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: 'Unknown airport "XXX"',
      description:
        'An unknown origin, an itinerary without days, a return before the ' +
        'outbound date or an invalid passenger mix',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    NOT_FOUND,
  )
  flights(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() q: ItineraryFlightsQueryDto,
  ) {
    return this.itineraryFlights.flightsFor(user, id, q);
  }
}
