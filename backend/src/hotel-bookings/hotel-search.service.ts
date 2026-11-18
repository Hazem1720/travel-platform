import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { localDate } from '../common/helpers/time-zone';
import { paginated } from '../common/pagination/pagination.helper';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import {
  Airport,
  AirportDocument,
  City,
  CityDocument,
  Country,
  CountryDocument,
} from '../reference/schemas/reference.schemas';
import { HotelSearchQueryDto } from './dto/hotel-search.dto';
import {
  FreeRoom,
  HotelAvailabilityService,
  stayNights,
} from './hotel-availability.service';

export interface HotelSearchCriteria {
  cityId?: string;
  countryCode?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
}

export interface HotelSearchResult {
  id: string;
  name: string;
  address: string;
  cityId: string;
  countryCode: string;
  starClass: number;
  images: string[];
  amenities: string[];
  ratingAverage: number;
  ratingCount: number;
  checkInTime: string;
  checkOutTime: string;
  fromPricePerNight: number;
  freeRoomCount: number;
}

function badRequest(field: string, message: string) {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// True if `rooms` of the free rooms can hold all the guests: the largest
// `rooms` occupancies added together cover `guests` (HTL-11).
export function fitsGuests(
  freeRooms: Pick<FreeRoom, 'maxOccupancy'>[],
  guests: number,
  rooms: number,
): boolean {
  if (freeRooms.length < rooms) return false;
  const capacity = freeRooms
    .map((r) => r.maxOccupancy)
    .sort((a, b) => b - a)
    .slice(0, rooms)
    .reduce((sum, n) => sum + n, 0);
  return capacity >= guests;
}

// HTL-11: hotel search. search() is the shared part: ITN-25 (Moharm) calls it
// for an itinerary's city group, and HTL-12 and HTL-15 build on it.
@Injectable()
export class HotelSearchService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
    @InjectModel(Country.name)
    private readonly countries: Model<CountryDocument>,
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    private readonly availability: HotelAvailabilityService,
  ) {}

  // "Today" where the hotels are, for "check-in cannot be in the past". Each
  // city in the reference data has an airport with an IANA time zone (New
  // York is behind UTC, Tokyo ahead). For a country with several zones the
  // earliest local date is used, so nobody's own today is refused. UTC if no
  // airport is found.
  async today(
    c: Pick<HotelSearchCriteria, 'cityId' | 'countryCode'>,
    now = new Date(),
  ): Promise<string> {
    const airports = await this.airports
      .find(c.cityId ? { cityId: c.cityId } : { countryCode: c.countryCode }, {
        timeZone: 1,
      })
      .lean();
    const dates = airports.map((a) => localDate(now, a.timeZone)).sort();
    return dates[0] ?? now.toISOString().slice(0, 10);
  }

  // Every active hotel in the city or country with at least `rooms` rooms
  // free for the whole stay whose largest occupancies cover the guests.
  // Cheapest first (by the cheapest free room), then by name.
  async search(c: HotelSearchCriteria): Promise<HotelSearchResult[]> {
    stayNights(c.checkIn, c.checkOut);
    if (!c.cityId && !c.countryCode) {
      throw badRequest('city', 'Give a city or a country');
    }
    if (c.cityId && !(await this.cities.exists({ _id: c.cityId }))) {
      throw badRequest('city', `Unknown city "${c.cityId}"`);
    }
    if (
      c.countryCode &&
      !(await this.countries.exists({ _id: c.countryCode }))
    ) {
      throw badRequest('country', `Unknown country "${c.countryCode}"`);
    }
    if (c.checkIn < (await this.today(c))) {
      throw badRequest('checkIn', 'checkIn cannot be in the past');
    }

    const hotels = await this.hotels
      .find({
        isActive: true,
        ...(c.cityId ? { cityId: c.cityId } : {}),
        ...(c.countryCode ? { countryCode: c.countryCode } : {}),
      })
      .lean();
    if (!hotels.length) return [];

    const free = await this.availability.freeRoomsByHotel(
      hotels.map((h) => String(h._id)),
      c.checkIn,
      c.checkOut,
    );
    const results: HotelSearchResult[] = [];
    for (const h of hotels) {
      const rooms = free.get(String(h._id)) ?? [];
      if (!fitsGuests(rooms, c.guests, c.rooms)) continue;
      results.push({
        id: String(h._id),
        name: h.name,
        address: h.address,
        cityId: h.cityId,
        countryCode: h.countryCode,
        starClass: h.starClass,
        images: h.images ?? [],
        amenities: h.amenities ?? [],
        ratingAverage: h.ratingAverage ?? 0,
        ratingCount: h.ratingCount ?? 0,
        checkInTime: h.checkInTime,
        checkOutTime: h.checkOutTime,
        fromPricePerNight: Math.min(...rooms.map((r) => r.pricePerNight)),
        freeRoomCount: rooms.length,
      });
    }
    return results.sort(
      (a, b) =>
        a.fromPricePerNight - b.fromPricePerNight ||
        a.name.localeCompare(b.name),
    );
  }

  // GET /hotels/search: one page of search().
  async searchPage(q: HotelSearchQueryDto) {
    const all = await this.search({
      cityId: q.city,
      countryCode: q.country,
      checkIn: q.checkIn,
      checkOut: q.checkOut,
      guests: q.guests,
      rooms: q.rooms,
    });
    const page = all.slice((q.page - 1) * q.limit, q.page * q.limit);
    return paginated(page, all.length, q.page, q.limit);
  }
}
