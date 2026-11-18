import { BadRequestException, Injectable } from '@nestjs/common';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { HotelSearchService } from '../hotel-bookings/hotel-search.service';
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

// ITN-25: hotels available for one city group of my itinerary, through
// Memo's hotel search (HTL-11, HotelSearchService.search), so the results are
// the same as GET /hotels/search with the group's city and dates.
@Injectable()
export class ItineraryHotelsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly hotelSearch: HotelSearchService,
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
    const all = await this.hotelSearch.search({
      cityId: stay.cityId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      guests: q.guests,
      rooms: q.rooms,
    });
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
}
