import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { platformCurrency } from '../common/helpers/money';
import {
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { AvailableRoomsQueryDto } from './dto/available-rooms.dto';
import {
  HotelAvailabilityService,
  stayNights,
} from './hotel-availability.service';
import { badRequest, HotelSearchService } from './hotel-search.service';

// The same text as Rawda's GET /hotels/:id (HTL-02).
export const HOTEL_NOT_FOUND = 'Hotel not found';

export interface AvailableRoom {
  id: string;
  name: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  nights: number;
  totalPrice: number;
}

export interface AvailableRoomsPage extends PaginatedResult<AvailableRoom> {
  hotel: {
    id: string;
    name: string;
    checkInTime: string;
    checkOutTime: string;
  };
  checkIn: string;
  checkOut: string;
  nights: number;
  currency: string;
}

// HTL-15: the rooms of one hotel that are free for the whole stay, with the
// total price, so the user can pick the rooms to book (HTL-16).
@Injectable()
export class HotelRoomsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly availability: HotelAvailabilityService,
    private readonly search: HotelSearchService,
  ) {}

  // The date rules are HTL-11's: checkOut after checkIn (stayNights) and
  // checkIn not before today in the hotel's city. An unknown or inactive
  // hotel answers 404; a malformed id is a cast error (400), like
  // GET /hotels/:id. Cheapest room first.
  async availableRooms(
    hotelId: string,
    q: AvailableRoomsQueryDto,
  ): Promise<AvailableRoomsPage> {
    const nights = stayNights(q.checkIn, q.checkOut).length;
    const hotel = await this.hotels.findById(hotelId).lean();
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException(HOTEL_NOT_FOUND);
    }
    if (q.checkIn < (await this.search.today({ cityId: hotel.cityId }))) {
      throw badRequest('checkIn', 'checkIn cannot be in the past');
    }

    // The one availability query (HTL-11): active rooms bookable on every
    // night, with no booking, block or unexpired hold.
    const free = await this.availability.freeRooms(
      String(hotel._id),
      q.checkIn,
      q.checkOut,
    );
    const rooms: AvailableRoom[] = free.map((r) => ({
      id: String(r._id),
      name: r.name,
      type: r.type,
      beds: r.beds,
      maxOccupancy: r.maxOccupancy,
      pricePerNight: r.pricePerNight,
      nights,
      totalPrice: nights * r.pricePerNight,
    }));

    const { page, limit } = q;
    return {
      hotel: {
        id: String(hotel._id),
        name: hotel.name,
        checkInTime: hotel.checkInTime,
        checkOutTime: hotel.checkOutTime,
      },
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      nights,
      currency: platformCurrency(),
      ...paginated(
        rooms.slice((page - 1) * limit, page * limit),
        rooms.length,
        page,
        limit,
      ),
    };
  }
}
