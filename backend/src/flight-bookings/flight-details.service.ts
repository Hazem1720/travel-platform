import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { CancellationTierLike } from '../common/helpers/cancellation-tiers';
import {
  FLIGHT_NOT_FOUND,
  FlightsService,
  FlightView,
} from '../flights/flights.service';
import {
  Flight,
  FlightDocument,
  FlightStatus,
} from '../flights/schemas/flight.schema';

// GET /api/flights/:id (FLT-17): Hazem's flight view with every cabin (price,
// seats remaining, baggage allowance), plus the airline and its policies.
export interface FlightDetails extends FlightView {
  airline: {
    _id: string;
    name: string;
    code: string;
    logo: string | null;
    // FLT-08: extra bags on top of each cabin's freeBags.
    extraBagPrice: number | null;
    maxExtraBags: number;
  };
  // FLT-09: the airline's cancellation policy, most days before first.
  cancellationTiers: CancellationTierLike[];
}

type LeanFlight = Flight & { _id: Types.ObjectId };
type LeanAirline = Airline & { _id: Types.ObjectId };

@Injectable()
export class FlightDetailsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly flightViews: FlightsService,
  ) {}

  // Public. A Cancelled flight, or a flight of an inactive airline (hidden
  // from search, ACC-15), answers 404 like an unknown id. A Departed flight
  // is still shown, with its status and bookable: false.
  async details(id: string): Promise<FlightDetails> {
    const flight = isValidObjectId(id)
      ? await this.flights.findById(id).lean<LeanFlight>()
      : null;
    if (!flight || flight.status === FlightStatus.CANCELLED) {
      throw new NotFoundException(FLIGHT_NOT_FOUND);
    }
    const airline = await this.airlines
      .findById(flight.airlineId)
      .lean<LeanAirline>();
    if (!airline?.isActive) throw new NotFoundException(FLIGHT_NOT_FOUND);

    const [view] = await this.flightViews.toViews([flight]);
    return {
      ...view,
      airline: {
        _id: String(airline._id),
        name: airline.name,
        code: airline.code,
        logo: airline.logo ?? null,
        extraBagPrice: airline.extraBagPrice ?? null,
        maxExtraBags: airline.maxExtraBags ?? 0,
      },
      cancellationTiers: [...(airline.cancellationTiers ?? [])]
        .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
        .sort((a, b) => b.daysBefore - a.daysBefore),
    };
  }
}
