import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AvailabilityRangeDto } from './dto/availability-range.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { RoomDto } from './dto/hotel.dto';
import { HOTEL_NOT_FOUND } from './hotels.service';
import { RANGE_OVERLAP, ROOM_NOT_FOUND, RoomsService } from './rooms.service';

const HOTEL_ID = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f801' };
const ROOM_ID = { name: 'roomId', example: '6735a1f4c1a2b3c4d5e6f901' };
const NOT_YOUR_HOTEL = {
  status: 403,
  message: 'You can only manage your assigned provider',
  description:
    "Not this hotel's moderator (other 403s: suspended account, " +
    `or "${MUST_CHANGE_PASSWORD.message}")`,
};

// Rooms and their bookable ranges. Every route is for the hotel's own
// moderator: the hotel id comes from the URL and is checked against the
// moderator's assigned hotel, never taken from the body.
@ApiTags('Hotel rooms')
@Controller('hotels')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post(':id/rooms')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(HOTEL_ID)
  @ApiOperation({ summary: 'Add a room to your hotel (HTL-03)' })
  @ApiCreatedResponse({ type: RoomDto, description: 'The new room' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { maxOccupancy: ['maxOccupancy must not be less than 1'] },
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    { status: 404, message: HOTEL_NOT_FOUND },
    {
      status: 409,
      message: 'A record with this name already exists',
      description: 'This hotel already has a room with that name or number',
      details: { name: ['must be unique'] },
    },
  )
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateRoomDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.rooms.create(id, dto);
  }

  @Post(':id/rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(HOTEL_ID)
  @ApiParam(ROOM_ID)
  @ApiOperation({
    summary: 'Add a bookable date range to a room of your hotel (HTL-04)',
  })
  @ApiCreatedResponse({
    type: RoomDto,
    description: 'The room with its bookable ranges, oldest first',
  })
  @ApiErrors(
    {
      status: 400,
      message: RANGE_OVERLAP,
      description:
        'Invalid dates, `to` on or before `from`, or a range that overlaps an existing one',
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    { status: 404, message: ROOM_NOT_FOUND },
  )
  addAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: AvailabilityRangeDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.rooms.addAvailability(id, roomId, dto);
  }
}
