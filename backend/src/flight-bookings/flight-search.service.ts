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
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import {
  assertSearchCriteria,
  passengerCounts,
  seatsNeeded,
} from './flight-booking.rules';

export const NO_FLIGHTS_FOUND = 'No flights found';

// One flight in the results: Hazem's flight view (local times, GEN-06) plus
// the airline, with only the cabins that have enough free seats.
export interface FlightOption extends FlightView {
  airline: { _id: string; name: string; code: string; logo: string | null };
}

export interface FlightSearchResult extends PaginatedResult<FlightOption> {
  // "No flights found" when nothing matches, otherwise null (FLT-11).
  message: string | null;
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

    const options = await this.findOptions(
      q.from,
      q.to,
      q.date,
      seatsNeeded(counts),
    );

    const { page, limit } = q;
    const result = paginated(
      options.slice((page - 1) * limit, page * limit),
      options.length,
      page,
      limit,
    );
    return {
      ...result,
      message: options.length === 0 ? NO_FLIGHTS_FOUND : null,
    };
  }

  // Bookable flights from -> to on a local date at the departure airport,
  // with at least one cabin that has `seats` free seats. Earliest first.
  //  - 400 if an airport is not in the list (FLT-02).
  //  - Only Scheduled flights that have not departed (FLT-30) of active
  //    airlines (ACC-15).
  //  - Infants take no seat, so `seats` is adults + children.
  async findOptions(
    from: string,
    to: string,
    date: string,
    seats: number,
  ): Promise<FlightOption[]> {
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

    // Keep only cabins with enough free seats, and only flights with one.
    const withSeats = flights
      .map((f) => ({
        ...f,
        cabins: (f.cabins ?? []).filter((c) => availableSeats(c) >= seats),
      }))
      .filter((f) => f.cabins.length > 0);

    return this.withAirlines(await this.flightViews.toViews(withSeats));
  }

  private async withAirlines(views: FlightView[]): Promise<FlightOption[]> {
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
