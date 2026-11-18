import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { AirportsService } from '../airports/airports.service';
import { Role } from '../common/enums/role.enum';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import { localToUtc, toZonedTime } from '../common/helpers/time-zone';
import {
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import {
  Airport,
  AirportDocument,
} from '../reference/schemas/reference.schemas';
import { AddCabinDto } from './dto/add-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightQueryDto } from './dto/flight-query.dto';
import { availableSeats, effectiveStatus, isBookable } from './flight-rules';
import { Flight, FlightDocument } from './schemas/flight.schema';

export const FLIGHT_NOT_FOUND = 'Flight not found';
export const NOT_SCHEDULED =
  'Only Scheduled flights that have not departed can be changed';

// A 400 in the shared format with the error under one field.
export function fieldError(field: string, message: string) {
  return new BadRequestException({
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// What every flight response shows (GEN-06): each time in UTC and in its
// airport's local time, plus the status a client should see (FLT-30).
export interface FlightView {
  _id: string;
  airlineId: string;
  flightNumber: string;
  from: { code: string; name: string; cityId: string; timeZone: string };
  to: { code: string; name: string; cityId: string; timeZone: string };
  departure: ReturnType<typeof toZonedTime>;
  arrival: ReturnType<typeof toZonedTime>;
  durationMinutes: number;
  departureDate: string;
  status: Flight['status'];
  bookable: boolean;
  cabins: Array<{
    _id: string;
    category: string;
    totalSeats: number;
    bookedSeats: number;
    heldSeats: number;
    availableSeats: number;
    price: number;
    freeBags: number;
    maxKgPerBag: number;
  }>;
}

type LeanFlight = Flight & { _id: Types.ObjectId };

// FLT-03 (create), FLT-04 (cabins), FLT-30 (status), GEN-06 (local times).
// Exported for Aabsy (search, holds, details), Memo (PAY-02) and Hasan
// (FLT-06, FLT-29): toViews() gives them the same response shape.
@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airport.name)
    private readonly airportModel: Model<AirportDocument>,
    private readonly airports: AirportsService,
    private readonly airlines: AirlinesService,
  ) {}

  // FLT-03. The airline is the moderator's assigned airline.
  async create(user: AuthUser, dto: CreateFlightDto): Promise<FlightView> {
    const airlineId = user.assignedProviderId;
    if (user.role !== Role.AIRLINE_MODERATOR || !airlineId) {
      throw new ForbiddenException(
        'You can only manage your assigned provider',
      );
    }
    await this.airlines.get(airlineId); // 404 if it no longer exists

    if (dto.from === dto.to) {
      throw fieldError('to', 'Departure and arrival airports must differ');
    }
    const [from, to] = await Promise.all([
      this.airports.assertAirportExists(dto.from),
      this.airports.assertAirportExists(dto.to),
    ]);
    const departureAt = localToUtc(dto.departureLocal, from.timeZone);
    const arrivalAt = localToUtc(dto.arrivalLocal, to.timeZone);
    if (arrivalAt.getTime() <= departureAt.getTime()) {
      throw fieldError(
        'arrivalLocal',
        'Arrival must be after departure (compared in UTC)',
      );
    }
    if (departureAt.getTime() <= Date.now()) {
      throw fieldError('departureLocal', 'Departure must be in the future');
    }

    const departureDate = dto.departureLocal.slice(0, 10);
    try {
      const flight = await this.flights.create({
        airlineId: new Types.ObjectId(airlineId),
        flightNumber: dto.flightNumber,
        from: dto.from,
        to: dto.to,
        departureAt,
        arrivalAt,
        departureDate,
      });
      const [view] = await this.toViews([flight.toObject() as LeanFlight]);
      return view;
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException({
          message:
            `Your airline already has flight ${dto.flightNumber} ` +
            `on ${departureDate}`,
          details: { flightNumber: ['must be unique per departure date'] },
        });
      }
      throw err;
    }
  }

  // GET /airlines/:id/flights: the moderator's own flights, next first.
  async listForAirline(
    airlineId: string,
    q: FlightQueryDto,
  ): Promise<PaginatedResult<FlightView>> {
    const filter: FilterQuery<FlightDocument> = {
      airlineId: new Types.ObjectId(airlineId),
    };
    if (q.status) filter.status = q.status;
    const { page, limit } = q;
    const [docs, total] = await Promise.all([
      this.flights
        .find(filter)
        .sort({ departureAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanFlight[]>(),
      this.flights.countDocuments(filter),
    ]);
    return paginated(await this.toViews(docs), total, page, limit);
  }

  // The flight, after checking that it belongs to the moderator's airline
  // (404 if it does not exist, 403 if it is another airline's).
  async getOwned(user: AuthUser, id: string): Promise<LeanFlight> {
    const flight = await this.flights.findById(id).lean<LeanFlight>();
    if (!flight) throw new NotFoundException(FLIGHT_NOT_FOUND);
    assertOwnsProvider(user, Role.AIRLINE_MODERATOR, String(flight.airlineId));
    return flight;
  }

  // FLT-04: each category at most once per flight. The check and the insert
  // are one conditional update, so two requests adding the same category at
  // the same moment cannot both succeed.
  async addCabin(
    user: AuthUser,
    id: string,
    dto: AddCabinDto,
  ): Promise<FlightView> {
    const flight = await this.getOwned(user, id);
    if (!isBookable(flight)) throw new BadRequestException(NOT_SCHEDULED);

    const updated = await this.flights
      .findOneAndUpdate(
        { _id: flight._id, 'cabins.category': { $ne: dto.category } },
        {
          $push: {
            cabins: {
              category: dto.category,
              totalSeats: dto.totalSeats,
              price: dto.price,
              freeBags: dto.freeBags,
              maxKgPerBag: dto.maxKgPerBag,
              bookedSeats: 0,
              heldSeats: 0,
            },
          },
        },
        { new: true, runValidators: true },
      )
      .lean<LeanFlight>();
    if (!updated) {
      throw new ConflictException({
        message: `This flight already has a ${dto.category} cabin`,
        details: { category: ['must be unique per flight'] },
      });
    }
    const [view] = await this.toViews([updated]);
    return view;
  }

  // GEN-06: the response shape of every flight, with local times. Looks the
  // airports up once for the whole list.
  async toViews(flights: LeanFlight[]): Promise<FlightView[]> {
    const codes = [...new Set(flights.flatMap((f) => [f.from, f.to]))];
    const airports = await this.airportModel
      .find({ _id: { $in: codes } })
      .lean<Airport[]>();
    const byCode = new Map(airports.map((a) => [a._id, a]));
    const place = (code: string) => {
      const a = byCode.get(code);
      return {
        code,
        name: a?.name ?? code,
        cityId: a?.cityId ?? '',
        timeZone: a?.timeZone ?? 'UTC',
      };
    };

    const now = new Date();
    return flights.map((f) => {
      const from = place(f.from);
      const to = place(f.to);
      return {
        _id: String(f._id),
        airlineId: String(f.airlineId),
        flightNumber: f.flightNumber,
        from,
        to,
        departure: toZonedTime(f.departureAt, from.timeZone),
        arrival: toZonedTime(f.arrivalAt, to.timeZone),
        durationMinutes: Math.round(
          (new Date(f.arrivalAt).getTime() -
            new Date(f.departureAt).getTime()) /
            60_000,
        ),
        departureDate: f.departureDate,
        status: effectiveStatus(f, now),
        bookable: isBookable(f, now),
        cabins: (f.cabins ?? []).map((c) => ({
          _id: String(c._id),
          category: c.category,
          totalSeats: c.totalSeats,
          bookedSeats: c.bookedSeats ?? 0,
          heldSeats: c.heldSeats ?? 0,
          availableSeats: availableSeats(c),
          price: c.price,
          freeBags: c.freeBags,
          maxKgPerBag: c.maxKgPerBag,
        })),
      };
    });
  }
}
