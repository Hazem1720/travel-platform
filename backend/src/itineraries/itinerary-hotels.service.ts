import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { HotelAvailabilityService } from '../hotel-bookings/hotel-availability.service';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { ItineraryHotelsQueryDto } from './dto/itinerary-search.dto';
import { ItinerariesService } from './itineraries.service';
import { cityGroups, dayDate, toDateOnly } from './itinerary.view';

// The dates of one city group: check-in on its first day, check-out the day
// after its last day.
export function groupStay(
  itinerary: { startDate: Date; days: { _id: unknown; cityId: string }[] },
  groupIndex: number,
) {
  const groups = cityGroups(itinerary.days);
  const group = groups[groupIndex];
  if (!group) {
    throw new BadRequestException({
      error: 'Bad Request',
      message: 'Validation failed',
      details: {
        groupIndex: [
          groups.length
            ? `groupIndex must be between 0 and ${groups.length - 1}`
            : 'This itinerary has no days yet',
        ],
      },
    });
  }
  return {
    ...group,
    checkIn: toDateOnly(dayDate(itinerary.startDate, group.fromDay - 1)),
    checkOut: toDateOnly(dayDate(itinerary.startDate, group.toDay)),
  };
}

// ITN-25: hotels available for one city group of my itinerary.
//
// The team plan says to call Memo's hotel search (HTL-11) and not copy its
// logic. Its search route is not in develop yet, so this uses the parts of
// HTL-11 that are: HotelAvailabilityService.freeRoomsByHotel (Memo's
// published contract) over the city's active hotels, plus the guests/rooms
// capacity check. When GET /hotels/search is merged, replace searchCity()
// with one call to Memo's search service.
@Injectable()
export class ItineraryHotelsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly availability: HotelAvailabilityService,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
  ) {}

  async hotelsForGroup(user: AuthUser, id: string, q: ItineraryHotelsQueryDto) {
    if (q.rooms > q.guests) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { rooms: ['rooms must not be more than guests'] },
      });
    }
    const itinerary = await this.itinerariesService.findOwned(user, id);
    const stay = groupStay(itinerary, q.groupIndex);
    const all = await this.searchCity(
      stay.cityId,
      stay.checkIn,
      stay.checkOut,
      q.guests,
      q.rooms,
    );
    const page = all.slice((q.page - 1) * q.limit, q.page * q.limit);
    return {
      search: {
        cityId: stay.cityId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        guests: q.guests,
        rooms: q.rooms,
        fromDay: stay.fromDay,
        toDay: stay.toDay,
      },
      ...paginated(page, all.length, q.page, q.limit),
    };
  }

  // Active hotels in the city with enough free rooms for the whole stay:
  // at least `rooms` free rooms whose largest `rooms` occupancies hold all
  // the guests. Cheapest first.
  private async searchCity(
    cityId: string,
    checkIn: string,
    checkOut: string,
    guests: number,
    rooms: number,
  ) {
    const hotels = await this.hotels.find({ cityId, isActive: true }).lean();
    if (!hotels.length) return [];
    const free = await this.availability.freeRoomsByHotel(
      hotels.map((h) => String(h._id)),
      checkIn,
      checkOut,
    );
    const results = [];
    for (const hotel of hotels) {
      const freeRooms = free.get(String(hotel._id)) ?? [];
      if (freeRooms.length < rooms) continue;
      const capacity = [...freeRooms]
        .map((r) => r.maxOccupancy)
        .sort((a, b) => b - a)
        .slice(0, rooms)
        .reduce((sum, n) => sum + n, 0);
      if (capacity < guests) continue;
      results.push({
        ...hotel,
        freeRooms,
        fromPricePerNight: Math.min(...freeRooms.map((r) => r.pricePerNight)),
      });
    }
    return results.sort((a, b) => a.fromPricePerNight - b.fromPricePerNight);
  }
}
