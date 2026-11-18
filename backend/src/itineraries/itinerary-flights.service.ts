import {
  BadRequestException,
  Inject,
  Injectable,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirportsService } from '../airports/airports.service';
import {
  PaginatedResult,
  paginated,
} from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import {
  Airport,
  AirportDocument,
} from '../reference/schemas/reference.schemas';
import { ItineraryFlightsQueryDto } from './dto/itinerary-search.dto';
import { ItinerariesService } from './itineraries.service';
import { dayDate, toDateOnly } from './itinerary.view';

// ITN-26 reuses Aabsy's flight search (FLT-11, FLT-12) through this contract.
// When it is merged, provide it in ItinerariesModule:
//   { provide: FLIGHT_SEARCH, useExisting: FlightSearchService }
export const FLIGHT_SEARCH = Symbol('FLIGHT_SEARCH');

export interface FlightSearchRequest {
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  page: number;
  limit: number;
}

export interface FlightSearchPort {
  search(q: FlightSearchRequest): Promise<PaginatedResult<unknown>>;
}

export const FLIGHT_SEARCH_NOT_READY =
  'Flight search (FLT-11, FLT-12) is not merged yet';

// ITN-26: one-way or round-trip flights from a chosen airport to any airport
// in the city of the itinerary's first day. Outbound on the start date,
// return on the last day's date.
@Injectable()
export class ItineraryFlightsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly airportsService: AirportsService,
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    @Optional()
    @Inject(FLIGHT_SEARCH)
    private readonly flightSearch?: FlightSearchPort,
  ) {}

  async flightsFor(user: AuthUser, id: string, q: ItineraryFlightsQueryDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    if (!itinerary.days.length) {
      throw new BadRequestException(
        'Add a day first: flights go to the city of the first day',
      );
    }
    const origin = await this.airportsService.assertAirportExists(q.origin);
    const cityId = itinerary.days[0].cityId;
    const destinations = (
      await this.airports.find({ cityId }, { _id: 1 }).sort({ _id: 1 }).lean()
    )
      .map((a) => String(a._id))
      .filter((code) => code !== origin._id);
    const date = toDateOnly(itinerary.startDate);
    const returnDate = q.roundTrip
      ? toDateOnly(dayDate(itinerary.startDate, itinerary.days.length - 1))
      : undefined;
    const search = {
      origin: origin._id,
      cityId,
      destinations,
      date,
      ...(returnDate ? { returnDate } : {}),
      roundTrip: q.roundTrip,
    };
    if (!destinations.length) {
      return { search, ...paginated([], 0, q.page, q.limit) };
    }
    if (!this.flightSearch) {
      throw new NotImplementedException({
        error: 'Not Implemented',
        message: FLIGHT_SEARCH_NOT_READY,
        details: { search },
      });
    }

    // One search per destination airport, merged; then paged here.
    const results = await Promise.all(
      destinations.map((to) =>
        this.flightSearch!.search({
          from: origin._id,
          to,
          date,
          returnDate,
          page: 1,
          limit: 10,
        }),
      ),
    );
    const all = results.flatMap((r) => r.data);
    const page = all.slice((q.page - 1) * q.limit, q.page * q.limit);
    return { search, ...paginated(page, all.length, q.page, q.limit) };
  }
}
