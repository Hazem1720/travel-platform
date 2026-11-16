import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AvailabilityRangeDto } from './dto/availability-range.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { HOTEL_NOT_FOUND } from './hotels.service';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Room, RoomDocument } from './schemas/room.schema';

export const ROOM_NOT_FOUND = 'Room not found';
export const RANGE_OVERLAP =
  'This range overlaps a bookable range the room already has';

// HTL-03 (add a room), HTL-04 (bookable date ranges). HTL-05, HTL-06 and
// HTL-08 are added here later, after Memo's RoomLock schema is merged.
@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
  ) {}

  // The name must be unique within the hotel. That rule is the unique index
  // on (hotelId, name): a duplicate is a duplicate-key error, which the global
  // filter turns into 409, even when two requests arrive at the same moment.
  async create(hotelId: string, dto: CreateRoomDto) {
    if (!(await this.hotels.exists({ _id: hotelId }))) {
      throw new NotFoundException(HOTEL_NOT_FOUND);
    }
    const room = await this.rooms.create({ ...dto, hotelId });
    return room.toObject();
  }

  // HTL-04. `to` must be after `from`; the new range may touch an existing
  // range (one ends the day the next starts) but not overlap it. The overlap
  // check and the insert are ONE conditional update, so two requests that add
  // overlapping ranges at the same moment cannot both succeed.
  async addAvailability(
    hotelId: string,
    roomId: string,
    dto: AvailabilityRangeDto,
  ) {
    if (dto.to <= dto.from) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { to: ['to must be after from'] },
      });
    }
    const updated = await this.rooms
      .findOneAndUpdate(
        {
          _id: roomId,
          hotelId,
          // No existing range [a, b) with a < to and b > from.
          bookableRanges: {
            $not: {
              $elemMatch: { from: { $lt: dto.to }, to: { $gt: dto.from } },
            },
          },
        },
        {
          $push: {
            bookableRanges: {
              $each: [{ from: dto.from, to: dto.to }],
              $sort: { from: 1 },
            },
          },
        },
        { new: true },
      )
      .lean();
    if (updated) return updated;

    // Nothing was updated: either the room is not in this hotel, or the range
    // overlaps. Look once to tell them apart.
    const room = await this.rooms.findOne({ _id: roomId, hotelId }).lean();
    if (!room) throw new NotFoundException(ROOM_NOT_FOUND);
    throw new BadRequestException(RANGE_OVERLAP);
  }
}
