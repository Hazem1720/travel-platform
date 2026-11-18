import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { AirportsService } from '../airports/airports.service';
import { Role } from '../common/enums/role.enum';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import {
  localDate,
  localToUtc,
  toZonedTime,
} from '../common/helpers/time-zone';
import {
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import {
  Airport,
  AirportDocument,
} from '../reference/schemas/reference.schemas';
import { AddCabinDto } from './dto/add-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightQueryDto } from './dto/flight-query.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import {
  FLIGHT_BOOKINGS_READER,
  FlightBookingsReader,
} from './flight-bookings.reader';
import {
  availableSeats,
  bookableFilter,
  effectiveStatus,
  isBookable,
} from './flight-rules';
import { Flight, FlightDocument } from './schemas/flight.schema';

export const FLIGHT_NOT_FOUND = 'Flight not found';
export const CABIN_NOT_FOUND = 'Cabin not found';
export const AIRPORTS_LOCKED =
  'Airports cannot be changed once the flight has a booking';
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
  private readonly logger = new Logger(FlightsService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airport.name)
    private readonly airportModel: Model<AirportDocument>,
    private readonly airports: AirportsService,
    private readonly airlines: AirlinesService,
    private readonly notifications: NotificationsService,
    @Optional()
    @Inject(FLIGHT_BOOKINGS_READER)
    private readonly bookings?: FlightBookingsReader,
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

  // FLT-05: does the flight have any booking? Asks Aabsy's bookings when
  // they are provided; until then a booked or held seat means yes.
  private async hasBookings(flight: LeanFlight): Promise<boolean> {
    if (this.bookings) return this.bookings.hasBookings(flight._id);
    return (flight.cabins ?? []).some(
      (c) => (c.bookedSeats ?? 0) + (c.heldSeats ?? 0) > 0,
    );
  }

  // FLT-05: edit the airports and the departure and arrival times of a
  // Scheduled flight. Times are local at each airport, as in FLT-03.
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateFlightDto,
  ): Promise<FlightView> {
    const flight = await this.getOwned(user, id);
    if (!isBookable(flight)) throw new BadRequestException(NOT_SCHEDULED);
    if (!dto.from && !dto.to && !dto.departureLocal && !dto.arrivalLocal) {
      throw new BadRequestException('Send at least one field to change');
    }

    const fromCode = dto.from ?? flight.from;
    const toCode = dto.to ?? flight.to;
    const airportsChanged = fromCode !== flight.from || toCode !== flight.to;
    if (airportsChanged && (await this.hasBookings(flight))) {
      throw new BadRequestException(AIRPORTS_LOCKED);
    }
    if (fromCode === toCode) {
      throw fieldError('to', 'Departure and arrival airports must differ');
    }
    const [from, to] = await Promise.all([
      this.airports.assertAirportExists(fromCode),
      this.airports.assertAirportExists(toCode),
    ]);
    const departureAt = dto.departureLocal
      ? localToUtc(dto.departureLocal, from.timeZone)
      : new Date(flight.departureAt);
    const arrivalAt = dto.arrivalLocal
      ? localToUtc(dto.arrivalLocal, to.timeZone)
      : new Date(flight.arrivalAt);
    if (arrivalAt.getTime() <= departureAt.getTime()) {
      throw fieldError(
        'arrivalLocal',
        'Arrival must be after departure (compared in UTC)',
      );
    }
    if (departureAt.getTime() <= Date.now()) {
      throw fieldError('departureLocal', 'Departure must be in the future');
    }

    let updated: LeanFlight | null;
    try {
      // Still Scheduled and not departed at the moment of the update.
      updated = await this.flights
        .findOneAndUpdate(
          { _id: flight._id, ...bookableFilter() },
          {
            $set: {
              from: fromCode,
              to: toCode,
              departureAt,
              arrivalAt,
              departureDate: localDate(departureAt, from.timeZone),
            },
          },
          { new: true, runValidators: true },
        )
        .lean<LeanFlight>();
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException({
          message:
            `Your airline already has flight ${flight.flightNumber} on ` +
            localDate(departureAt, from.timeZone),
          details: { departureLocal: ['must be unique per departure date'] },
        });
      }
      throw err;
    }
    if (!updated) throw new BadRequestException(NOT_SCHEDULED);

    const timeChanged =
      departureAt.getTime() !== new Date(flight.departureAt).getTime() ||
      arrivalAt.getTime() !== new Date(flight.arrivalAt).getTime();
    const [view] = await this.toViews([updated]);
    if (timeChanged) await this.notifyScheduleChange(view);
    return view;
  }

  // FLT-05: only passengers with a Confirmed booking are told (GEN-01).
  // A failed notification never undoes the change.
  private async notifyScheduleChange(view: FlightView): Promise<void> {
    if (!this.bookings) return;
    const userIds = await this.bookings.confirmedUserIds(view._id);
    const message =
      `Flight ${view.flightNumber} ${view.from.code}-${view.to.code} now ` +
      `departs ${view.departure.local.replace('T', ' ')} ` +
      `(${view.from.timeZone}) and arrives ` +
      `${view.arrival.local.replace('T', ' ')} (${view.to.timeZone})`;
    const unique = [...new Set(userIds.map(String))];
    await Promise.all(
      unique.map((userId) =>
        this.notifications
          .create(userId, NotificationType.FLIGHT_SCHEDULE_CHANGED, message, {
            flightId: view._id,
            flightNumber: view.flightNumber,
            departure: view.departure,
            arrival: view.arrival,
          })
          .catch((err: Error) =>
            this.logger.error(`Notification failed: ${err.message}`),
          ),
      ),
    );
  }

  // FLT-05: price and seat count of one cabin. The seat check and the
  // update are one conditional update, so a hold made at the same moment
  // cannot push booked + held above the new total.
  async updateCabin(
    user: AuthUser,
    id: string,
    cabinId: string,
    dto: UpdateCabinDto,
  ): Promise<FlightView> {
    const flight = await this.getOwned(user, id);
    if (!isBookable(flight)) throw new BadRequestException(NOT_SCHEDULED);
    if (dto.price === undefined && dto.totalSeats === undefined) {
      throw new BadRequestException('Send price, totalSeats or both');
    }
    const cabin = (flight.cabins ?? []).find(
      (c) => String(c._id) === String(cabinId),
    );
    if (!cabin) throw new NotFoundException(CABIN_NOT_FOUND);

    const set: Record<string, number> = {};
    if (dto.price !== undefined) set['cabins.$[c].price'] = dto.price;
    if (dto.totalSeats !== undefined) {
      set['cabins.$[c].totalSeats'] = dto.totalSeats;
    }
    const filter: FilterQuery<FlightDocument> = {
      _id: flight._id,
      ...bookableFilter(),
    };
    if (dto.totalSeats !== undefined) {
      // The cabin's booked + held seats must still fit in the new total.
      filter.$expr = {
        $anyElementTrue: {
          $map: {
            input: '$cabins',
            as: 'cab',
            in: {
              $and: [
                { $eq: ['$$cab._id', cabin._id] },
                {
                  $lte: [
                    { $add: ['$$cab.bookedSeats', '$$cab.heldSeats'] },
                    dto.totalSeats,
                  ],
                },
              ],
            },
          },
        },
      };
    }
    const updated = await this.flights
      .findOneAndUpdate(
        filter,
        { $set: set },
        {
          new: true,
          runValidators: true,
          arrayFilters: [{ 'c._id': cabin._id }],
        },
      )
      .lean<LeanFlight>();
    if (updated) {
      const [view] = await this.toViews([updated]);
      return view;
    }

    // Not updated: tell the reasons apart with a fresh read.
    const now = await this.flights.findById(flight._id).lean<LeanFlight>();
    if (!now) throw new NotFoundException(FLIGHT_NOT_FOUND);
    if (!isBookable(now)) throw new BadRequestException(NOT_SCHEDULED);
    const fresh = now.cabins.find((c) => String(c._id) === String(cabinId));
    const taken = (fresh?.bookedSeats ?? 0) + (fresh?.heldSeats ?? 0);
    throw new ConflictException(
      `Seats cannot go below the ${taken} already booked or held`,
    );
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
