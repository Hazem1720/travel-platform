import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import {
  AvailableRoomsPageDto,
  AvailableRoomsQueryDto,
} from './dto/available-rooms.dto';
import { HOTEL_NOT_FOUND, HotelRoomsService } from './hotel-rooms.service';

// HTL-15. Its own controller under the hotels/ prefix; the extra
// /rooms/available segments never clash with Rawda's GET /hotels/:id.
@ApiTags('Hotels')
@Controller('hotels')
export class HotelRoomsController {
  constructor(private readonly rooms: HotelRoomsService) {}

  @Get(':id/rooms/available')
  @Public()
  @ApiParam({ name: 'id', example: '6735a1f4c1a2b3c4d5e6f801' })
  @ApiOperation({
    summary: "A hotel's rooms free for the stay, with the total (HTL-15)",
    description:
      'Every active room of the hotel that is free for every night from ' +
      'checkIn up to checkOut (no booking, block or unexpired hold), with ' +
      'type, beds, maxOccupancy, pricePerNight, the number of nights and ' +
      'totalPrice = nights x pricePerNight, in USD cents. Cheapest first, ' +
      '10 per page. Pick rooms by id to book them (HTL-16). No login needed.',
  })
  @ApiOkResponse({
    type: AvailableRoomsPageDto,
    description: 'One page of free rooms (an empty list when none is free)',
  })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { checkOut: ['checkOut must be after checkIn'] },
      description:
        'checkOut on or before checkIn, checkIn in the past, a date that ' +
        'is not YYYY-MM-DD, or a malformed hotel id',
    },
    {
      status: 404,
      message: HOTEL_NOT_FOUND,
      description: 'No such hotel, or the hotel is inactive',
    },
  )
  available(@Param('id') id: string, @Query() q: AvailableRoomsQueryDto) {
    return this.rooms.availableRooms(id, q);
  }
}
