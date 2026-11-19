import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import {
  FlightBookingGroup,
  FlightBookingSummaryDto,
  MyFlightBookingsQueryDto,
} from './dto/my-flight-bookings.dto';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

// Which bookings belong in each tab (FLT-25).
//
// A booking is over once its last flight has landed (GEN-11, the same rule
// as FlightBookingJobs.completeLanded). "Past" also takes Confirmed
// bookings that are over but not yet marked Completed, so a trip never
// stays "upcoming" in the minute before the job runs. Expired holds (never
// paid) appear in no tab.
export function flightGroupFilter(
  group: FlightBookingGroup,
  userId: Types.ObjectId,
  now: Date = new Date(),
): FilterQuery<FlightBookingDocument> {
  const notLanded = { $elemMatch: { arrivalAt: { $gt: now } } };
  switch (group) {
    case FlightBookingGroup.UPCOMING:
      return {
        userId,
        $or: [
          { status: BookingStatus.CONFIRMED, segments: notLanded },
          // A hold still waiting for payment, so the user can find it again.
          { status: BookingStatus.PENDING_PAYMENT, expiresAt: { $gt: now } },
        ],
      };
    case FlightBookingGroup.PAST:
      return {
        userId,
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, segments: { $not: notLanded } },
        ],
      };
    case FlightBookingGroup.CANCELLED:
      return { userId, status: BookingStatus.CANCELLED };
  }
}

// Soonest departure first for upcoming (an ascending sort on an array uses
// its earliest value: the outbound flight); most recent first for the
// others. _id breaks ties so pages never repeat or skip a row.
export const FLIGHT_GROUP_SORT: Record<
  FlightBookingGroup,
  Record<string, 1 | -1>
> = {
  [FlightBookingGroup.UPCOMING]: { 'segments.departureAt': 1, _id: 1 },
  [FlightBookingGroup.PAST]: { 'segments.departureAt': -1, _id: -1 },
  [FlightBookingGroup.CANCELLED]: { cancelledAt: -1, _id: -1 },
};

// FLT-25 (Hasan): the user's own flight bookings, one tab at a time. Reads
// the FlightBooking collection only; uses the { userId, status, createdAt }
// index added for it.
@Injectable()
export class MyFlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
  ) {}

  async list(
    user: AuthUser,
    { group, page, limit }: MyFlightBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResult<FlightBookingSummaryDto>> {
    const filter = flightGroupFilter(group, new Types.ObjectId(user.id), now);
    const [data, total] = await Promise.all([
      this.bookings.aggregate<FlightBookingSummaryDto>([
        { $match: filter },
        { $sort: FLIGHT_GROUP_SORT[group] },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            reference: 1,
            status: 1,
            // Each flight with its cabin; prices are on the details page.
            segments: {
              $map: {
                input: '$segments',
                as: 's',
                in: {
                  flightNumber: '$$s.flightNumber',
                  from: '$$s.from',
                  to: '$$s.to',
                  departureAt: '$$s.departureAt',
                  arrivalAt: '$$s.arrivalAt',
                  cabin: '$$s.cabin',
                },
              },
            },
            // Names and types only: passport numbers and birth dates stay
            // on the details page.
            passengers: {
              $map: {
                input: '$passengers',
                as: 'p',
                in: { fullName: '$$p.fullName', type: '$$p.type' },
              },
            },
            totalAmount: 1,
            currency: 1,
            expiresAt: 1,
            cancelledAt: 1,
            createdAt: 1,
          },
        },
      ]),
      this.bookings.countDocuments(filter),
    ]);
    return paginated(data, total, page, limit);
  }
}
