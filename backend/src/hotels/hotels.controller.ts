import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
} from '@nestjs/common';
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
import { IMAGE_LIMITS, UploadedImage } from '../uploads/image-file';
import { ImageUpload } from '../uploads/image-upload.decorator';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelDetailsDto, HotelDetailsQueryDto } from './dto/hotel-details.dto';
import { HotelDto } from './dto/hotel.dto';
import { HotelPoliciesDto } from './dto/policies.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import {
  BOTH_DATES,
  HOTEL_NOT_FOUND,
  HotelsService,
  IMAGE_NOT_FOUND,
} from './hotels.service';

const ID_PARAM = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f801' };
const IMAGE_PARAM = {
  name: 'imageId',
  example: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.png',
  description: 'The file name at the end of the image URL',
};
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

  // Memo's GET /hotels/search must be registered before this module so
  // "search" is not read as an :id (team plan, B4).
  @Get(':id')
  @Public()
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Hotel details page (HTL-02)',
    description:
      'The hotel profile with photos, amenities, check-in and check-out ' +
      'times, cancellation tiers, average rating and the newest 10 reviews. ' +
      'With checkIn and checkOut, also the rooms free for every night of the ' +
      'stay, cheapest first, with the total price. No login needed.',
  })
  @ApiOkResponse({ type: HotelDetailsDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { checkOut: [BOTH_DATES] },
      description:
        'Only one of the two dates, checkOut on or before checkIn, checkIn ' +
        'in the past, a date that is not YYYY-MM-DD, or a malformed hotel id',
    },
    {
      ...NOT_FOUND,
      description: 'No such hotel, or the hotel is inactive',
    },
  )
  get(@Param('id') id: string, @Query() q: HotelDetailsQueryDto) {
    return this.hotels.details(id, q);
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

  @Post(':id/images')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ImageUpload('images', IMAGE_LIMITS.HOTEL)
  @ApiOperation({
    summary: 'Add photos to your hotel, its moderator only (HTL-01, GEN-08)',
    description:
      'Up to 5 photos per hotel in total, JPG or PNG, at most 5 MB each. ' +
      'Returns the hotel with the new photo URLs at the end of `images`.',
  })
  @ApiCreatedResponse({ type: HotelDto, description: 'The updated hotel' })
  @ApiErrors(
    {
      status: 400,
      message: 'At most 5 images allowed (4 already uploaded)',
      description:
        'More than 5 photos in total, not a JPG or PNG, larger than 5 MB, ' +
        'or no file',
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    NOT_FOUND,
  )
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.hotels.addImages(id, files);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiParam(IMAGE_PARAM)
  @ApiOperation({
    summary: 'Remove a photo from your hotel, its moderator only (HTL-01)',
  })
  @ApiOkResponse({ type: HotelDto, description: 'The updated hotel' })
  @ApiErrors(UNAUTHENTICATED, NOT_YOUR_HOTEL, {
    status: 404,
    message: IMAGE_NOT_FOUND,
    description: 'The hotel does not exist or does not have this photo',
  })
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.hotels.removeImage(id, imageId);
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
