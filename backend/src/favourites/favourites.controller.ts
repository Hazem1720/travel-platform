import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  CreateFavouriteDto,
  FavouriteDto,
  FavouriteListDto,
} from './dto/favourite.dto';
import {
  ALREADY_SAVED,
  FAVOURITE_NOT_FOUND,
  FavouritesService,
  HOTEL_NOT_FOUND,
  ITINERARY_NOT_FOUND,
} from './favourites.service';

const NOT_A_USER = {
  status: 403,
  message: 'You do not have permission for this action',
  description: 'Not a registered user',
};

// BON-02 (Memo, bonus): save hotels and public itineraries to a
// favourites list and view it.
@ApiTags('Favourites')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('favourites')
export class FavouritesController {
  constructor(private readonly favourites: FavouritesService) {}

  @Post()
  @ApiOperation({
    summary: 'Save a hotel or a public itinerary to your favourites (BON-02)',
    description:
      'type is hotel or itinerary. Only an active hotel or a public ' +
      'itinerary (not hidden, by an active author) can be saved; anything ' +
      'else answers 404. Saving the same one twice answers 409.',
  })
  @ApiCreatedResponse({ type: FavouriteDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { type: ['type must be hotel or itinerary'] },
      description: 'A missing or unknown type, or an id that is not valid',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    {
      status: 404,
      message: HOTEL_NOT_FOUND,
      description: `No such active hotel, or "${ITINERARY_NOT_FOUND}" (missing, private or hidden)`,
    },
    { status: 409, message: ALREADY_SAVED },
  )
  add(@CurrentUser() user: AuthUser, @Body() dto: CreateFavouriteDto) {
    return this.favourites.add(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Your favourites (BON-02)',
    description:
      'Newest first, 10 per page. Each entry has a short summary of the ' +
      'hotel or itinerary. One that is no longer available (inactive ' +
      'hotel, itinerary made private or hidden) is still listed, with ' +
      'available: false and no summary, so you can remove it.',
  })
  @ApiOkResponse({ type: FavouriteListDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Cannot sort by "name". Allowed: ',
      description: 'Only createdAt can be used to sort',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
  )
  list(@CurrentUser() user: AuthUser, @Query() q: PaginationQueryDto) {
    return this.favourites.list(user, q);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', example: '6737e2b3c1a2b3c4d5e6fe01' })
  @ApiOperation({
    summary: 'Remove one of your favourites (BON-02)',
    description:
      "The favourite's own id (from the list). Another user's favourite " +
      'answers 404.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, {
    status: 404,
    message: FAVOURITE_NOT_FOUND,
    description: "No such favourite, or another user's",
  })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.favourites.remove(user, id);
  }
}
