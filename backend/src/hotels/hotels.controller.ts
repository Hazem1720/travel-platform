import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelDto } from './dto/hotel.dto';
import { HotelPoliciesDto } from './dto/policies.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HOTEL_NOT_FOUND, HotelsService } from './hotels.service';

const ID_PARAM = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f801' };
const NOT_FOUND = { status: 404, message: HOTEL_NOT_FOUND };
const NOT_YOUR_HOTEL = {
  status: 403,
  message: 'You can only manage your assigned provider',
  description:
    "Not this hotel's moderator (other 403s: suspended account, " +
    `or "${MUST_CHANGE_PASSWORD.message}")`,
};

@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotels: HotelsService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Create a hotel profile, admin only (HTL-01)' })
  @ApiCreatedResponse({ type: HotelDto, description: 'The new hotel' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { starClass: ['starClass must not be greater than 5'] },
      description:
        'Invalid fields, an unknown city, or a city that is not in that country',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not an admin, or the account is suspended',
    },
  )
  create(@Body() dto: CreateHotelDto) {
    return this.hotels.create(dto);
  }

  // The same route later shows the available rooms and the newest reviews
  // (the rest of HTL-02). Memo's GET /hotels/search must be registered before
  // this module so "search" is not read as an :id (team plan, B4).
  @Get(':id')
  @Public()
  @ApiParam(ID_PARAM)
  @ApiOperation({ summary: 'Hotel details page (HTL-02)' })
  @ApiOkResponse({ type: HotelDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Invalid value for "_id"',
      details: { _id: ['"abc" is not valid'] },
    },
    {
      ...NOT_FOUND,
      description: 'No such hotel, or the hotel is inactive',
    },
  )
  get(@Param('id') id: string) {
    return this.hotels.getPublic(id);
  }

  @Patch(':id')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: "Edit your hotel's profile, its moderator only (HTL-01)",
  })
  @ApiOkResponse({ type: HotelDto, description: 'The updated hotel' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { name: ['name should not be empty'] },
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    NOT_FOUND,
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateHotelDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.hotels.update(id, dto);
  }

  @Put(':id/policies')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary:
      'Set check-in/out times and cancellation tiers, its moderator only (HTL-09, HTL-10)',
  })
  @ApiOkResponse({ type: HotelDto, description: 'The updated hotel' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        checkInTime: [
          'checkInTime must be a 24-hour time written as HH:mm, such as 14:00',
        ],
      },
      description:
        'A bad time, a refund percentage outside 0-100, or two tiers with the same daysBefore',
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    NOT_FOUND,
  )
  setPolicies(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: HotelPoliciesDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.hotels.setPolicies(id, dto);
  }
}
