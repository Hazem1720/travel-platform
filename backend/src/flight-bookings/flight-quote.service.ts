import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { availableSeats, isBookable } from '../flights/flight-rules';
import {
  FLIGHT_NOT_FOUND,
  FlightsService,
  FlightView,
} from '../flights/flights.service';
import {
  Cabin,
  CabinCategory,
  Flight,
  FlightDocument,
  FlightStatus,
} from '../flights/schemas/flight.schema';
import { FlightQuoteDto, PassengerDto } from './dto/flight-quote.dto';
import {
  assertPassengers,
  PassengerCounts,
  PriceBreakdown,
  priceBooking,
  seatsNeeded,
} from './flight-booking.rules';

// One flight of the booking (a round trip has two), as shown in the summary
// and stored by the hold (FLT-22).
export interface QuoteSegment {
  flightId: string;
  flightNumber: string;
  airline: { _id: string; name: string; code: string; logo: string | null };
  from: FlightView['from'];
  to: FlightView['to'];
  departure: FlightView['departure'];
  arrival: FlightView['arrival'];
  durationMinutes: number;
  cabinId: string;
  cabin: CabinCategory;
  // Per seat, USD cents. Infants pay 10% of it.
  cabinFare: number;
  freeBags: number;
  maxKgPerBag: number;
  extraBagPrice: number | null;
}

// FLT-21 summary: the flights, the cabin, each passenger, baggage and total.
// The hold (FLT-22) stores exactly this price, and the Stripe amount is
// price.total, so the three can never differ.
export interface FlightQuote {
  segments: QuoteSegment[];
  passengers: PassengerDto[];
  counts: PassengerCounts;
  // Seats taken on each segment: adults and children (infants take none).
  seats: number;
  price: PriceBreakdown;
}

type LeanFlight = Flight & { _id: Types.ObjectId };
type LeanAirline = Airline & { _id: Types.ObjectId };

function fieldError(field: string, message: string) {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// FLT-19 and FLT-21: POST /api/flight-bookings. Checks the flights, the
// cabin, the passengers and their bags, and prices the booking. Nothing is
// reserved here; the hold (FLT-22) calls quote() again and then reserves.
@Injectable()
export class FlightQuoteService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly flightViews: FlightsService,
  ) {}

  async quote(dto: FlightQuoteDto): Promise<FlightQuote> {
    const outbound = await this.loadFlight(dto.outboundFlightId);
    const inbound = dto.returnFlightId
      ? await this.loadFlight(dto.returnFlightId)
      : null;
    if (inbound) assertReturnFlight(outbound, inbound);
    const flights = inbound ? [outbound, inbound] : [outbound];

    // FLT-19: each type must match the date of birth on the departure date
    // (the local date at the departure airport); FLT-12 mix rules.
    const counts = assertPassengers(dto.passengers, outbound.departureDate);
    const seats = seatsNeeded(counts);

    const airlines = await this.loadAirlines(flights);
    const cabins = flights.map((f) => cabinFor(f, dto.cabin, seats));
    const views = await this.flightViews.toViews(flights);

    const segments: QuoteSegment[] = flights.map((f, i) => {
      const airline = airlines.get(String(f.airlineId))!;
      const cabin = cabins[i];
      return {
        flightId: String(f._id),
        flightNumber: f.flightNumber,
        airline: {
          _id: String(airline._id),
          name: airline.name,
          code: airline.code,
          logo: airline.logo ?? null,
        },
        from: views[i].from,
        to: views[i].to,
        departure: views[i].departure,
        arrival: views[i].arrival,
        durationMinutes: views[i].durationMinutes,
        cabinId: String(cabin._id),
        cabin: cabin.category,
        cabinFare: cabin.price,
        freeBags: cabin.freeBags,
        maxKgPerBag: cabin.maxKgPerBag,
        extraBagPrice: airline.extraBagPrice ?? null,
      };
    });

    // FLT-19: extra bags up to each airline's maxExtraBags and each cabin's
    // maxKgPerBag, fee = bags x extraBagPrice per segment.
    const price = priceBooking(
      segments.map((s, i) => ({
        cabinFare: s.cabinFare,
        maxKgPerBag: s.maxKgPerBag,
        extraBagPrice: s.extraBagPrice,
        maxExtraBags: airlines.get(String(flights[i].airlineId))!.maxExtraBags,
      })),
      dto.passengers,
    );

    return { segments, passengers: dto.passengers, counts, seats, price };
  }

  // 404 like the details page for unknown or Cancelled flights; 409 for a
  // flight that has departed and can no longer be booked (FLT-30).
  private async loadFlight(id: string): Promise<LeanFlight> {
    const flight = isValidObjectId(id)
      ? await this.flights.findById(id).lean<LeanFlight>()
      : null;
    if (!flight || flight.status === FlightStatus.CANCELLED) {
      throw new NotFoundException(FLIGHT_NOT_FOUND);
    }
    if (!isBookable(flight)) {
      throw new ConflictException(
        `Flight ${flight.flightNumber} can no longer be booked`,
      );
    }
    return flight;
  }

  // Inactive airlines are hidden from search and new bookings (ACC-15).
  private async loadAirlines(
    flights: LeanFlight[],
  ): Promise<Map<string, LeanAirline>> {
    const ids = [...new Set(flights.map((f) => String(f.airlineId)))];
    const found = await this.airlines
      .find({ _id: { $in: ids } })
      .lean<LeanAirline[]>();
    const byId = new Map(found.map((a) => [String(a._id), a]));
    for (const id of ids) {
      if (!byId.get(id)?.isActive) {
        throw new NotFoundException(FLIGHT_NOT_FOUND);
      }
    }
    return byId;
  }
}

// FLT-12 round trip: the return flies the reversed route and leaves after
// the outbound flight lands.
function assertReturnFlight(outbound: LeanFlight, inbound: LeanFlight): void {
  if (inbound.from !== outbound.to || inbound.to !== outbound.from) {
    throw fieldError(
      'returnFlightId',
      `The return flight must fly ${outbound.to} to ${outbound.from}`,
    );
  }
  if (new Date(inbound.departureAt) <= new Date(outbound.arrivalAt)) {
    throw fieldError(
      'returnFlightId',
      'The return flight must leave after the outbound flight lands',
    );
  }
}

// The chosen cabin on this flight, with enough free seats. The hold checks
// the seats again atomically; this gives a clear message early.
function cabinFor(
  flight: LeanFlight,
  category: CabinCategory,
  seats: number,
): Cabin {
  const cabin = (flight.cabins ?? []).find((c) => c.category === category);
  if (!cabin) {
    throw fieldError(
      'cabin',
      `Flight ${flight.flightNumber} has no ${category} cabin`,
    );
  }
  const left = availableSeats(cabin);
  if (left < seats) {
    throw new ConflictException(
      `Only ${left} ${category} seat${left === 1 ? '' : 's'} left on ` +
        `flight ${flight.flightNumber}`,
    );
  }
  return cabin;
}
