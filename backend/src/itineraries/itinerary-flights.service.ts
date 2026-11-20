import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AirportsService } from '../airports/airports.service';
import { AuthUser } from '../common/types/auth-user.type';
import {
  assertSearchCriteria,
  parseFlightSort,
  passengerCounts,
} from '../flight-bookings/flight-booking.rules';
import {
  byFlightSort,
  FlightOption,
  FlightOptionList,
  FlightSearchService,
  returnsAfter,
  toPage,
} from '../flight-bookings/flight-search.service';
import {
  Airport,
  AirportDocument,
} from '../reference/schemas/reference.schemas';
import { ItineraryFlightsQueryDto } from './dto/itinerary-search.dto';
import { ItinerariesService } from './itineraries.service';
import { dayDate, toDateOnly } from './itinerary.view';

export interface ItineraryFlightSearch {
  origin: string;
  cityId: string;
  destinations: string[];
  date: string;
  returnDate?: string;
  roundTrip: boolean;
}

// data/meta/message: outbound flights to any airport of the first day's
// city; returnFlights: the flights back for a round trip, else null. The
// same shape as GET /api/flights/search, plus the search that was run.
export interface ItineraryFlightsResult extends FlightOptionList {
  search: ItineraryFlightSearch;
  returnFlights: FlightOptionList | null;
}

// ITN-26: one-way or round-trip flights from a chosen airport to any airport
// in the city of the itinerary's first day, reusing Aabsy's FLT-11/FLT-12
// search (FlightSearchService.findOptions: bookable flights of active
// airlines with enough seats, local dates, fares). The outbound date defaults
// to the start date and the return date to the last day's date.
@Injectable()
export class ItineraryFlightsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly airportsService: AirportsService,
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    private readonly flightSearch: FlightSearchService,
  ) {}

  async flightsFor(
    user: AuthUser,
    id: string,
    q: ItineraryFlightsQueryDto,
  ): Promise<ItineraryFlightsResult> {
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

    const roundTrip = q.roundTrip || q.returnDate !== undefined;
    const date = q.date ?? toDateOnly(itinerary.startDate);
    const returnDate = roundTrip
      ? (q.returnDate ??
        toDateOnly(dayDate(itinerary.startDate, itinerary.days.length - 1)))
      : undefined;

    // FLT-12's rules: return not before the outbound date, a valid
    // passenger mix. "to" differs from the origin by construction.
    const passengers = passengerCounts(q);
    assertSearchCriteria({
      from: origin._id,
      to: '',
      date,
      returnDate,
      ...passengers,
    });
    const sort = parseFlightSort(q.sort);

    const search: ItineraryFlightSearch = {
      origin: origin._id,
      cityId,
      destinations,
      date,
      ...(returnDate ? { returnDate } : {}),
      roundTrip,
    };

    const common = { passengers, cabin: q.cabin, sort };
    // One FLT-11 search per destination airport, merged and sorted again.
    const merge = async (
      route: (to: string) => { from: string; to: string; date: string },
    ): Promise<FlightOption[]> =>
      (
        await Promise.all(
          destinations.map((to) =>
            this.flightSearch.findOptions({ ...route(to), ...common }),
          ),
        )
      )
        .flat()
        .sort(byFlightSort(sort));

    const outbound = await merge((to) => ({ from: origin._id, to, date }));
    const inbound = returnDate
      ? returnsAfter(
          outbound,
          await merge((to) => ({ from: to, to: origin._id, date: returnDate })),
        )
      : null;

    return {
      search,
      ...toPage(outbound, q.page, q.limit),
      returnFlights: inbound
        ? toPage(inbound, q.returnPage ?? 1, q.limit)
        : null,
    };
  }
}
