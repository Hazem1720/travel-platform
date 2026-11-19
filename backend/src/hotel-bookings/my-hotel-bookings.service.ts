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
  HotelBookingSummaryDto,
  MyHotelBookingsQueryDto,
  ReservationGroup,
} from './dto/my-hotel-bookings.dto';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

// Today's date as YYYY-MM-DD in UTC, the format of checkIn and checkOut.
// UTC rather than each hotel's local date: it only decides which tab a stay
// appears in, and is at most a few hours off around midnight.
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Which reservations belong in each tab (HTL-20).
//
// A stay is over once its check-out date has passed (HTL-23), so on the
// check-out day itself it is still upcoming. "Past" also takes Confirmed
// stays that are over but not yet marked Completed, so a stay never stays
// "upcoming" after it ended, whether or not the Completed job has run.
// Expired reservations (a hold that was never paid) appear in no tab.
export function groupFilter(
  group: ReservationGroup,
  userId: Types.ObjectId,
  now: Date = new Date(),
): FilterQuery<HotelBookingDocument> {
  const today = utcToday(now);
  switch (group) {
    case ReservationGroup.UPCOMING:
      return {
        userId,
        $or: [
          { status: BookingStatus.CONFIRMED, checkOut: { $gte: today } },
          // A hold still waiting for payment, so the user can find it again.
          { status: BookingStatus.PENDING_PAYMENT, expiresAt: { $gt: now } },
        ],
      };
    case ReservationGroup.PAST:
      return {
        userId,
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, checkOut: { $lt: today } },
        ],
      };
    case ReservationGroup.CANCELLED:
      return { userId, status: BookingStatus.CANCELLED };
  }
}

// Soonest stay first for upcoming; most recent first for the others.
// _id breaks ties so pages never repeat or skip a row.
export const GROUP_SORT: Record<ReservationGroup, Record<string, 1 | -1>> = {
  [ReservationGroup.UPCOMING]: { checkIn: 1, _id: 1 },
  [ReservationGroup.PAST]: { checkOut: -1, _id: -1 },
  [ReservationGroup.CANCELLED]: { cancelledAt: -1, _id: -1 },
};

// HTL-20 (Hasan): the user's own hotel reservations, one tab at a time.
// Reads the HotelBooking collection only; uses the
// { userId, status, createdAt } index Memo added for it.
@Injectable()
export class MyHotelBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
  ) {}

  async list(
    user: AuthUser,
    { group, page, limit }: MyHotelBookingsQueryDto,
    now: Date = new Date(),
  ): Promise<PaginatedResult<HotelBookingSummaryDto>> {
    const filter = groupFilter(group, new Types.ObjectId(user.id), now);
    const [data, total] = await Promise.all([
      this.bookings.aggregate<HotelBookingSummaryDto>([
        { $match: filter },
        { $sort: GROUP_SORT[group] },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            reference: 1,
            status: 1,
            hotelId: 1,
            hotelName: 1,
            checkIn: 1,
            checkOut: 1,
            nights: 1,
            // The list shows each room's name and type; prices and guest
            // ages are on the details page.
            rooms: {
              $map: {
                input: '$rooms',
                as: 'r',
                in: { name: '$$r.name', type: '$$r.type' },
              },
            },
            // Totals over all rooms of the reservation.
            guests: {
              adults: { $sum: '$rooms.adults' },
              children: {
                $sum: {
                  $map: {
                    input: '$rooms',
                    as: 'r',
                    in: { $size: { $ifNull: ['$$r.childAges', []] } },
                  },
                },
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
