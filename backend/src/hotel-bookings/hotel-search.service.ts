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

// HTL-12: sort by the hotel's price (its cheapest qualifying room) or by its
// average rating.
export type HotelSortField = 'price' | 'rating';
export interface HotelSort {
  field: HotelSortField;
  direction: 1 | -1;
}
export const HOTEL_SORT_FIELDS: HotelSortField[] = ['price', 'rating'];
export const DEFAULT_HOTEL_SORT: HotelSort = { field: 'price', direction: 1 };

export interface HotelSearchCriteria {
  cityId?: string;
  countryCode?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  // HTL-12, all optional: inclusive range on fromPricePerNight (USD cents),
  // minimum average rating (1-5; unrated hotels are then left out) and the
  // order. Without them the HTL-11 results are unchanged.
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sort?: HotelSort;
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

export function badRequest(field: string, message: string) {
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

// HTL-12: ?sort=price|rating with :asc or :desc (default price:asc). 400 for
// anything else.
export function parseHotelSort(sort?: string): HotelSort {
  if (!sort) return DEFAULT_HOTEL_SORT;
  const [field, dir = 'asc', ...rest] = sort.split(':');
  if (
    !HOTEL_SORT_FIELDS.includes(field as HotelSortField) ||
    (dir !== 'asc' && dir !== 'desc') ||
    rest.length
  ) {
    throw badRequest(
      'sort',
      'sort must be price or rating, optionally with :asc or :desc',
    );
  }
  return { field: field as HotelSortField, direction: dir === 'asc' ? 1 : -1 };
}

// HTL-12: min and max both given and min above max is a 400.
export function assertPriceRange(minPrice?: number, maxPrice?: number): void {
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw badRequest('minPrice', 'minPrice cannot be greater than maxPrice');
  }
}

// HTL-12: the price is the hotel's cheapest qualifying room per night
// (fromPricePerNight), inclusive on both ends. With minRating, a hotel
// without any rating is left out even if its stored average is 0.
export function matchesHotelFilters(
  h: Pick<
    HotelSearchResult,
    'fromPricePerNight' | 'ratingAverage' | 'ratingCount'
  >,
  c: Pick<HotelSearchCriteria, 'minPrice' | 'maxPrice' | 'minRating'>,
): boolean {
  if (c.minPrice !== undefined && h.fromPricePerNight < c.minPrice) {
    return false;
  }
  if (c.maxPrice !== undefined && h.fromPricePerNight > c.maxPrice) {
    return false;
  }
  if (c.minRating !== undefined) {
    return h.ratingCount > 0 && h.ratingAverage >= c.minRating;
  }
  return true;
}

// HTL-12 order. Ties: the other key (cheaper first for a rating sort, better
// rated first for a price sort), then the name, so pages stay stable.
export function byHotelSort({ field, direction }: HotelSort) {
  return (a: HotelSearchResult, b: HotelSearchResult): number => {
    const price = a.fromPricePerNight - b.fromPricePerNight;
    const rating = a.ratingAverage - b.ratingAverage;
    const primary = field === 'price' ? price : rating;
    const secondary = field === 'price' ? -rating : price;
    return primary * direction || secondary || a.name.localeCompare(b.name);
  };
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
  // Cheapest first (by the cheapest free room), then by name, unless HTL-12's
  // sort says otherwise; HTL-12's price and rating filters keep every other
  // criterion.
  async search(c: HotelSearchCriteria): Promise<HotelSearchResult[]> {
    stayNights(c.checkIn, c.checkOut);
    assertPriceRange(c.minPrice, c.maxPrice);
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
      const result: HotelSearchResult = {
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
      };
      if (matchesHotelFilters(result, c)) results.push(result);
    }
    return results.sort(byHotelSort(c.sort ?? DEFAULT_HOTEL_SORT));
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
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      minRating: q.minRating,
      sort: parseHotelSort(q.sort),
    });
    const page = all.slice((q.page - 1) * q.limit, q.page * q.limit);
    return paginated(page, all.length, q.page, q.limit);
  }
}
