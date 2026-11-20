import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import { Role } from '../common/enums/role.enum';
import {
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  HotelReservationsQueryDto,
  MODERATOR_VISIBLE,
} from './dto/hotel-reservations.dto';
import { badRequest } from './hotel-search.service';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

// The filter for one hotel's reservations. A stay covers the nights
// checkIn up to, not including, checkOut, so it has a night in [from, to]
// when checkOut > from and checkIn <= to. Dates are YYYY-MM-DD strings, so
// string comparison is date order.
export function reservationsFilter(
  hotelId: Types.ObjectId,
  {
    status,
    from,
    to,
  }: Pick<HotelReservationsQueryDto, 'status' | 'from' | 'to'>,
): FilterQuery<HotelBookingDocument> {
  if (from && to && from > to) {
    throw badRequest('to', 'to cannot be before from');
  }
  const filter: FilterQuery<HotelBookingDocument> = {
    hotelId,
    status: status ? status : { $in: MODERATOR_VISIBLE },
  };
  if (to) filter.checkIn = { $lte: to };
  if (from) filter.checkOut = { $gt: from };
  return filter;
}

// HTL-22 (Hasan): a hotel moderator's view of their hotel's reservations
// (guest, dates, status). Reads Memo's HotelBooking collection with the
// { hotelId, checkIn } index added for it.
@Injectable()
export class HotelReservationsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  // GET /hotels/:id/reservations. Another hotel's id is 403 before any
  // lookup (as in the other moderator hotel routes); the moderator's own
  // hotel that no longer exists is 404.
  async list(
    user: AuthUser,
    hotelId: string,
    query: HotelReservationsQueryDto,
  ): Promise<PaginatedResult<unknown>> {
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, hotelId);
    const hotel = await this.hotels.exists({ _id: hotelId });
    if (!hotel) throw new NotFoundException(HOTEL_NOT_FOUND);

    const { page, limit } = query;
    const filter = reservationsFilter(new Types.ObjectId(hotelId), query);
    const [data, total] = await Promise.all([
      this.bookings.aggregate([
        { $match: filter },
        { $sort: { checkIn: 1, _id: 1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $lookup: {
            from: this.users.collection.name,
            localField: 'userId',
            foreignField: '_id',
            as: 'guest',
            pipeline: [{ $project: { name: 1, email: 1 } }],
          },
        },
        {
          $project: {
            reference: 1,
            status: 1,
            // A deleted account still shows the reservation.
            guest: { $ifNull: [{ $first: '$guest' }, null] },
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
            checkIn: 1,
            checkOut: 1,
            nights: 1,
            rooms: {
              $map: {
                input: '$rooms',
                as: 'r',
                in: { name: '$$r.name', type: '$$r.type' },
              },
            },
            totalAmount: 1,
            currency: 1,
            cancelledAt: 1,
          },
        },
      ]),
      this.bookings.countDocuments(filter),
    ]);
    return paginated(data, total, page, limit);
  }
}
