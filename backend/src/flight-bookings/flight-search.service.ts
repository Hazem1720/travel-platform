import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { AirportsService } from '../airports/airports.service';
import { localDayRangeUtc } from '../common/helpers/time-zone';
import {
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { availableSeats, bookableFilter } from '../flights/flight-rules';
import { FlightsService, FlightView } from '../flights/flights.service';
import {
  CabinCategory,
  Flight,
  FlightDocument,
} from '../flights/schemas/flight.schema';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import {
  assertSearchCriteria,
  faresTotal,
  FlightSort,
  PassengerCounts,
  passengerCounts,
  parseFlightSort,
  priceInRange,
  seatsNeeded,
} from './flight-booking.rules';

export const NO_FLIGHTS_FOUND = 'No flights found';

// One cabin in the results: Hazem's cabin view plus totalFare, what these
// passengers pay in it before extra bags (FLT-12: infants pay 10%).
export type CabinOption = FlightView['cabins'][number] & { totalFare: number };

// One flight in the results: Hazem's flight view (local times, GEN-06) plus
// the airline, with only the cabins that have enough free seats (and match
// ?cabin when it is given).
export interface FlightOption extends Omit<FlightView, 'cabins'> {
  airline: { _id: string; name: string; code: string; logo: string | null };
  cabins: CabinOption[];
  // FLT-15: the cheapest listed cabin's price per seat, what the price
  // filter and the price sort use.
  lowestPrice: number;
}

// What findOptions() needs. Moharm's itineraries (ITN-26) call it with the
// same object.
export interface FlightSearchCriteria {
  from: string;
  to: string;
  // Local date at the departure airport, YYYY-MM-DD.
  date: string;
  passengers: PassengerCounts;
  cabin?: CabinCategory;
  // FLT-15: inclusive, USD cents per seat.
  minPrice?: number;
  maxPrice?: number;
  // FLT-15: default earliest departure first.
  sort?: FlightSort;
}

// One list of flights: a page of options, and "No flights found" when the
// list is empty (FLT-11), otherwise null.
export interface FlightOptionList extends PaginatedResult<FlightOption> {
  message: string | null;
}

// data/meta/message: the outbound flights. returnFlights: the flights back
// for a round trip (?returnDate, FLT-12), or null for a one-way search.
export interface FlightSearchResult extends FlightOptionList {
  returnFlights: FlightOptionList | null;
}

type LeanFlight = Flight & { _id: Types.ObjectId };

// FLT-11 flight search. Moharm's itineraries (ITN-26) call findOptions()
// directly, so the rules live here and not in the controller.
@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly airports: AirportsService,
    private readonly flightViews: FlightsService,
  ) {}

  async search(q: FlightSearchQueryDto): Promise<FlightSearchResult> {
    const counts = passengerCounts(q);
    assertSearchCriteria({ ...q, ...counts });

    const common = {
      passengers: counts,
      cabin: q.cabin,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      sort: parseFlightSort(q.sort),
    };
    // FLT-12 round trip: the return is the reversed route on returnDate (the
    // local date at the arrival airport, where the return departs). Both
    // lists are listed separately; the user picks one flight from each.
    const [outbound, inbound] = await Promise.all([
      this.findOptions({ from: q.from, to: q.to, date: q.date, ...common }),
      q.returnDate
        ? this.findOptions({
            from: q.to,
            to: q.from,
            date: q.returnDate,
            ...common,
          })
        : null,
    ]);

    return {
      ...toPage(outbound, q.page, q.limit),
      returnFlights: inbound ? toPage(inbound, q.page, q.limit) : null,
    };
  }

  // Bookable flights from -> to on a local date at the departure airport,
  // with at least one cabin (of the chosen category, if any) that has enough
  // free seats. Earliest first.
  //  - 400 if an airport is not in the list (FLT-02).
  //  - Only Scheduled flights that have not departed (FLT-30) of active
  //    airlines (ACC-15).
  //  - Infants take no seat, so the seats needed are adults + children.
  async findOptions({
    from,
    to,
    date,
    passengers,
    cabin,
    minPrice,
    maxPrice,
    sort = { field: 'departure', direction: 1 },
  }: FlightSearchCriteria): Promise<FlightOption[]> {
    const seats = seatsNeeded(passengers);
    const [departure] = await Promise.all([
      this.airports.assertAirportExists(from),
      this.airports.assertAirportExists(to),
    ]);

    // "2 Dec" means 2 Dec at the departure airport: 00:30 Cairo time on
    // 2 Dec is 22:30 UTC on 1 Dec, so search that day's UTC window.
    const { start, end } = localDayRangeUtc(date, departure.timeZone);
    const bookable = bookableFilter();
    const inactive = await this.airlines
      .find({ isActive: false }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();

    const flights = await this.flights
      .find({
        ...bookable,
        from,
        to,
        departureAt: { ...bookable.departureAt, $gte: start, $lt: end },
        airlineId: { $nin: inactive.map((a) => a._id) },
      })
      .sort({ departureAt: 1 })
      .lean<LeanFlight[]>();

    // Keep only cabins with enough free seats (and of the chosen category),
    // and only flights that still have one.
    const withSeats = flights
      .map((f) => ({
        ...f,
        cabins: (f.cabins ?? []).filter(
          (c) => availableSeats(c) >= seats && (!cabin || c.category === cabin),
        ),
      }))
      .filter((f) => f.cabins.length > 0);

    const views = await this.flightViews.toViews(withSeats);
    const options = views
      .map((v) => ({
        ...v,
        cabins: v.cabins.map((c) => ({
          ...c,
          totalFare: faresTotal(passengers, c.price),
        })),
        // The chosen cabin's price, or the cheapest one with enough seats.
        lowestPrice: Math.min(...v.cabins.map((c) => c.price)),
      }))
      // FLT-15: the other criteria stay applied; the range is inclusive.
      .filter((o) => priceInRange(o.lowestPrice, minPrice, maxPrice))
      .sort(byFlightSort(sort));
    return this.withAirlines(options);
  }

  private async withAirlines(
    views: Omit<FlightOption, 'airline'>[],
  ): Promise<FlightOption[]> {
    const ids = [...new Set(views.map((v) => v.airlineId))];
    const airlines = await this.airlines
      .find({ _id: { $in: ids } }, { name: 1, code: 1, logo: 1 })
      .lean<(Airline & { _id: Types.ObjectId })[]>();
    const byId = new Map(airlines.map((a) => [String(a._id), a]));
    return views.map((v) => {
      const a = byId.get(v.airlineId);
      return {
        ...v,
        airline: {
          _id: v.airlineId,
          name: a?.name ?? '',
          code: a?.code ?? '',
          logo: a?.logo ?? null,
        },
      };
    });
  }
}

// The same page and limit apply to both lists of a round trip.
function toPage(
  options: FlightOption[],
  page: number,
  limit: number,
): FlightOptionList {
  return {
    ...paginated(
      options.slice((page - 1) * limit, page * limit),
      options.length,
      page,
      limit,
    ),
    message: options.length === 0 ? NO_FLIGHTS_FOUND : null,
  };
}

// FLT-15: price (cheapest listed cabin), duration (arrival minus departure in
// UTC) or departure time. Ties: earliest departure first.
function byFlightSort({ field, direction }: FlightSort) {
  const departure = (o: Omit<FlightOption, 'airline'>) =>
    new Date(o.departure.utc).getTime();
  const key = {
    price: (o: Omit<FlightOption, 'airline'>) => o.lowestPrice,
    duration: (o: Omit<FlightOption, 'airline'>) => o.durationMinutes,
    departure,
  }[field];
  return (a: Omit<FlightOption, 'airline'>, b: Omit<FlightOption, 'airline'>) =>
    (key(a) - key(b)) * direction || departure(a) - departure(b);
}
