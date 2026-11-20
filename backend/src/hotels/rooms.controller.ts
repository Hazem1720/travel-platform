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
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
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
import {
  HotelCalendarDto,
  HotelCalendarQueryDto,
  RoomBlockResultDto,
  UpdateRoomAvailabilityDto,
} from './dto/room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { HOTEL_NOT_FOUND } from './hotels.service';
import {
  BLOCK_CONFLICT,
  ONE_AVAILABILITY_ACTION,
  RANGE_OVERLAP,
  RESERVED_NIGHTS_NOT_COVERED,
  ROOM_HAS_RESERVATIONS,
  ROOM_NOT_FOUND,
  ROOM_WAS_RESERVED,
  RoomsService,
} from './rooms.service';

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
@ApiExtraModels(RoomDto, RoomBlockResultDto)
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

  @Patch(':id/rooms/:roomId')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(HOTEL_ID)
  @ApiParam(ROOM_ID)
  @ApiOperation({
    summary:
      "Edit a room's beds, occupancy, price, or deactivate it (HTL-05, HTL-06)",
    description:
      'Send only the fields to change. A new price applies to new ' +
      'reservations only: existing ones keep the price they were booked at. ' +
      'isActive=false hides the room from search and is refused while a ' +
      'Confirmed or PendingPayment reservation covers a future night; ' +
      'isActive=true reactivates it.',
  })
  @ApiOkResponse({ type: RoomDto, description: 'The updated room' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { pricePerNight: ['pricePerNight must not be less than 1'] },
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    { status: 404, message: ROOM_NOT_FOUND },
    {
      status: 409,
      message: ROOM_HAS_RESERVATIONS,
      description: 'Deactivating a room that has a future reservation',
    },
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.rooms.update(id, roomId, dto);
  }

  @Patch(':id/rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(HOTEL_ID)
  @ApiParam(ROOM_ID)
  @ApiOperation({
    summary:
      "Change a room's bookable ranges, or block or unblock dates (HTL-05, HTL-06)",
    description:
      'Send exactly one of:\n' +
      '- `ranges` (HTL-05): the full new list of bookable ranges. Refused ' +
      'with 409 if a future night with a Confirmed or PendingPayment ' +
      'reservation would no longer be covered. Returns the room.\n' +
      '- `block` (HTL-06): blocks the nights from `from` up to, not ' +
      'including, `to`. Refused with 409 if any of them is held, booked or ' +
      'already blocked; nothing is blocked then. Blocked nights drop out ' +
      'of search (HTL-11, HTL-15).\n' +
      '- `unblock` (HTL-06): removes the blocked nights in the range.',
  })
  @ApiOkResponse({
    description:
      'With `ranges`: the updated room. With `block` or `unblock`: how many nights changed.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(RoomDto) },
        { $ref: getSchemaPath(RoomBlockResultDto) },
      ],
    },
    example: {
      roomId: '6735a1f4c1a2b3c4d5e6f901',
      from: '2026-12-10',
      to: '2026-12-13',
      nights: 3,
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: ONE_AVAILABILITY_ACTION,
      description:
        'Not exactly one of ranges, block or unblock; `to` on or before ' +
        '`from`; overlapping ranges; or a date that is not YYYY-MM-DD',
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    { status: 404, message: ROOM_NOT_FOUND },
    {
      status: 409,
      message: RESERVED_NIGHTS_NOT_COVERED,
      details: { nights: ['2026-12-20'] },
      description: `Removing reserved nights from the ranges, or (block) "${BLOCK_CONFLICT}"`,
    },
  )
  updateAvailability(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomAvailabilityDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.rooms.updateAvailability(id, roomId, dto);
  }

  @Delete(':id/rooms/:roomId')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(HOTEL_ID)
  @ApiParam(ROOM_ID)
  @ApiOperation({
    summary: 'Delete a room that was never reserved (HTL-06)',
    description:
      'Only rooms that have never had a reservation (other than an unpaid ' +
      'hold that expired) can be deleted. Deactivate the others with ' +
      'PATCH isActive=false.',
  })
  @ApiOkResponse({
    description: 'The room was deleted',
    schema: {
      example: { id: '6735a1f4c1a2b3c4d5e6f901', deleted: true },
    },
  })
  @ApiErrors(
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    {
      status: 404,
      message: ROOM_NOT_FOUND,
    },
    {
      status: 409,
      message: ROOM_WAS_RESERVED,
    },
  )
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('roomId') roomId: string,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.rooms.remove(id, roomId);
  }

  @Get(':id/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(HOTEL_ID)
  @ApiOperation({
    summary: "Each room's status per night for a date range (HTL-08)",
    description:
      'For every room of your hotel (10 per page, by name) and every night ' +
      'from `from` up to, not including, `to` (at most 31 nights): ' +
      'Available, Booked (with the reservation reference; a hold still ' +
      'waiting for payment shows bookingStatus PendingPayment and no ' +
      'reference yet), Blocked, or Unavailable (outside every bookable ' +
      'range, or the room is deactivated).',
  })
  @ApiOkResponse({ type: HotelCalendarDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { to: ['to must be after from'] },
      description:
        '`to` on or before `from`, more than 31 nights, or a date that is not YYYY-MM-DD',
    },
    UNAUTHENTICATED,
    NOT_YOUR_HOTEL,
    { status: 404, message: HOTEL_NOT_FOUND },
  )
  calendar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() q: HotelCalendarQueryDto,
  ) {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, id);
    return this.rooms.calendar(id, q);
  }
}
