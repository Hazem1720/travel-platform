import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { PAGE_SIZE } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../flight-bookings/schemas/flight-booking.schema';
import {
  HotelBooking,
  HotelBookingDocument,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { presentWithBudget, summarizeByCurrency } from './budget.summary';
import { LinkBookingDto } from './dto/link-booking.dto';
import { ItinerariesService } from './itineraries.service';
import {
  Itinerary,
  ItineraryDocument,
  LinkedBookingType,
} from './schemas/itinerary.schema';

export const BOOKING_NOT_FOUND = 'Booking not found';
export const LINK_NOT_FOUND = 'Linked booking not found';
const LINKABLE = [BookingStatus.CONFIRMED, BookingStatus.COMPLETED];

// A linked booking as the routes return it: every stored field and the
// day's number.
type LinkedBookingView = Record<string, unknown> & {
  dayNumber: number | null;
};

interface BookingFacts {
  reference: string | null;
  label: string;
  amount: number;
  currency: string;
}

// ITN-27 (bonus): link the user's own Confirmed (or Completed) flight and
// hotel bookings to days of their itinerary. The booking total, in the
// platform currency's main unit (cents / 100), feeds the budget: hotels under
// Accommodation, flights under Intercity transport (budget.summary.ts).
@Injectable()
export class ItineraryBookingsService {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    @InjectModel(FlightBooking.name)
    private readonly flightBookings: Model<FlightBookingDocument>,
    @InjectModel(HotelBooking.name)
    private readonly hotelBookings: Model<HotelBookingDocument>,
  ) {}

  async list(
    user: AuthUser,
    id: string,
    { page, limit }: { page: number; limit: number },
  ) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    return this.view(itinerary, page, limit);
  }

  async link(user: AuthUser, id: string, dto: LinkBookingDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    if (!itinerary.days.some((d) => String(d._id) === dto.dayId)) {
      throw new NotFoundException('Day not found');
    }
    const facts = await this.bookingFacts(user, dto.type, dto.bookingId);
    const bookingId = new Types.ObjectId(dto.bookingId);
    const dayId = new Types.ObjectId(dto.dayId);

    // Atomic: the day must still exist and the booking must not be linked
    // to this itinerary already (once per itinerary).
    const updated = await this.itineraries
      .findOneAndUpdate(
        {
          _id: itinerary._id,
          ownerId: itinerary.ownerId,
          'days._id': dayId,
          'linkedBookings.bookingId': { $ne: bookingId },
        },
        {
          $push: {
            linkedBookings: { type: dto.type, bookingId, dayId, ...facts },
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) {
      const again = await this.itinerariesService.findOwned(user, id);
      if (
        (again.linkedBookings ?? []).some(
          (b) => String(b.bookingId) === dto.bookingId,
        )
      ) {
        throw new ConflictException(
          'This booking is already linked to this itinerary',
        );
      }
      throw new NotFoundException('Day not found');
    }
    return this.view(updated);
  }

  async unlink(user: AuthUser, id: string, linkId: string) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    if (
      !isValidObjectId(linkId) ||
      !(itinerary.linkedBookings ?? []).some((b) => String(b._id) === linkId)
    ) {
      throw new NotFoundException(LINK_NOT_FOUND);
    }
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: itinerary._id, ownerId: itinerary.ownerId },
        { $pull: { linkedBookings: { _id: new Types.ObjectId(linkId) } } },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException(LINK_NOT_FOUND);
    return this.view(updated);
  }

  // One page of the linked bookings (GEN-05) with their day number, and the
  // budget fed by all of them. Link and unlink answer with the first page.
  private view(
    itinerary: Parameters<typeof presentWithBudget>[0] & {
      _id: unknown;
      linkedBookings?: (Record<string, unknown> & { dayId: unknown })[];
    },
    page = 1,
    limit = PAGE_SIZE,
  ) {
    const dayNumber = new Map(
      itinerary.days.map((d, i) => [String(d._id), i + 1]),
    );
    const presented = presentWithBudget(itinerary);
    const all = itinerary.linkedBookings ?? [];
    const pageItems = all.slice((page - 1) * limit, page * limit).map(
      (b): LinkedBookingView => ({
        ...b,
        dayNumber: dayNumber.get(String(b.dayId)) ?? null,
      }),
    );
    return {
      itineraryId: itinerary._id,
      ...paginated(pageItems, all.length, page, limit),
      budget: summarizeByCurrency(itinerary),
      cityGroups: presented.cityGroups,
    };
  }

  // The user's own booking, Confirmed or Completed: what the link stores.
  // Another user's or unknown booking is 404 (ACC-11); other states 400.
  private async bookingFacts(
    user: AuthUser,
    type: LinkedBookingType,
    id: string,
  ): Promise<BookingFacts> {
    const filter = { _id: id, userId: new Types.ObjectId(user.id) };
    if (type === LinkedBookingType.FLIGHT) {
      const b = await this.flightBookings.findOne(filter).lean();
      if (!b) throw new NotFoundException(BOOKING_NOT_FOUND);
      this.assertLinkable(b.status);
      return {
        reference: b.reference,
        label: b.segments
          .map((s) => `${s.flightNumber} ${s.from}-${s.to}`)
          .join(', '),
        amount: b.totalAmount / 100,
        currency: b.currency,
      };
    }
    const b = await this.hotelBookings.findOne(filter).lean();
    if (!b) throw new NotFoundException(BOOKING_NOT_FOUND);
    this.assertLinkable(b.status);
    return {
      reference: b.reference,
      label: `${b.hotelName}, ${b.checkIn} to ${b.checkOut}`,
      amount: b.totalAmount / 100,
      currency: b.currency,
    };
  }

  private assertLinkable(status: BookingStatus) {
    if (!LINKABLE.includes(status)) {
      throw new BadRequestException(
        `Only a Confirmed or Completed booking can be linked (this one is ${status})`,
      );
    }
  }
}
