import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { paginated } from '../common/pagination/pagination.helper';
import {
  FlightBooking,
  FlightBookingDocument,
} from '../flight-bookings/schemas/flight-booking.schema';
import {
  HotelBooking,
  HotelBookingDocument,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  AdminBookingsQueryDto,
  AdminBookingType,
} from './dto/admin-bookings.dto';

export const BAD_DATE_RANGE = '"from" must not be after "to"';

// Flight and hotel bookings in one shape, so they can be listed together.
// Dates are YYYY-MM-DD: hotel stays already are; flights use the UTC date of
// the first departure and of the last arrival.
const FLIGHT_ROW: PipelineStage.Project['$project'] = {
  type: { $literal: AdminBookingType.FLIGHT },
  reference: 1,
  status: 1,
  userId: 1,
  providerId: { $first: '$segments.airlineId' },
  providerName: null,
  summary: {
    $reduce: {
      input: '$segments',
      initialValue: '',
      in: {
        $concat: [
          '$$value',
          { $cond: [{ $eq: ['$$value', ''] }, '', ', '] },
          '$$this.from',
          '-',
          '$$this.to',
        ],
      },
    },
  },
  startDate: {
    $dateToString: {
      format: '%Y-%m-%d',
      date: { $min: '$segments.departureAt' },
    },
  },
  endDate: {
    $dateToString: {
      format: '%Y-%m-%d',
      date: { $max: '$segments.arrivalAt' },
    },
  },
  amount: '$totalAmount',
  currency: 1,
  createdAt: 1,
};

const HOTEL_ROW: PipelineStage.Project['$project'] = {
  type: { $literal: AdminBookingType.HOTEL },
  reference: 1,
  status: 1,
  userId: 1,
  providerId: '$hotelId',
  providerName: '$hotelName',
  summary: '$hotelName',
  startDate: '$checkIn',
  endDate: '$checkOut',
  amount: '$totalAmount',
  currency: 1,
  createdAt: 1,
};

// ACC-17 (Hasan): a read-only list of every flight and hotel booking for
// admins, newest first, filterable by type, status and travel date range.
@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBookingDocument>,
    @InjectModel(HotelBooking.name)
    private readonly hotels: Model<HotelBookingDocument>,
  ) {}

  async list(q: AdminBookingsQueryDto) {
    if (q.from && q.to && q.from > q.to) {
      throw new BadRequestException(BAD_DATE_RANGE);
    }
    // Filters that apply to the unified rows.
    const match: Record<string, unknown> = {};
    if (q.status) match.status = q.status;
    if (q.from || q.to) {
      match.startDate = {
        ...(q.from ? { $gte: q.from } : {}),
        ...(q.to ? { $lte: q.to } : {}),
      };
    }

    // Start from one collection; add the other with $unionWith when both
    // types are wanted. Mongo then filters, sorts and pages the whole set.
    const flightsOnly = q.type === AdminBookingType.FLIGHT;
    const hotelsOnly = q.type === AdminBookingType.HOTEL;
    const base = hotelsOnly ? this.hotels : this.flights;
    const pipeline: PipelineStage[] = [
      { $project: hotelsOnly ? HOTEL_ROW : FLIGHT_ROW },
    ];
    if (!flightsOnly && !hotelsOnly) {
      pipeline.push({
        $unionWith: {
          coll: this.hotels.collection.name,
          pipeline: [{ $project: HOTEL_ROW }],
        },
      });
    }
    pipeline.push(
      { $match: match },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1, _id: -1 } },
            { $skip: (q.page - 1) * q.limit },
            { $limit: q.limit },
            ...this.names(),
          ],
          total: [{ $count: 'n' }],
        },
      },
    );
    const [result] = await (base as Model<unknown>).aggregate<{
      data: unknown[];
      total: { n: number }[];
    }>(pipeline);
    return paginated(
      result?.data ?? [],
      result?.total[0]?.n ?? 0,
      q.page,
      q.limit,
    );
  }

  // The page's user names and emails, and airline names (hotel names are
  // stored on the booking).
  private names(): PipelineStage.FacetPipelineStage[] {
    return [
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, email: 1 } }],
          as: 'u',
        },
      },
      {
        $lookup: {
          from: 'airlines',
          localField: 'providerId',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1 } }],
          as: 'a',
        },
      },
      {
        $project: {
          type: 1,
          reference: 1,
          status: 1,
          user: {
            id: '$userId',
            name: { $ifNull: [{ $first: '$u.name' }, ''] },
            email: { $ifNull: [{ $first: '$u.email' }, ''] },
          },
          provider: {
            id: '$providerId',
            name: {
              $ifNull: [
                '$providerName',
                { $ifNull: [{ $first: '$a.name' }, ''] },
              ],
            },
          },
          summary: 1,
          startDate: 1,
          endDate: 1,
          amount: 1,
          currency: 1,
          createdAt: 1,
        },
      },
    ];
  }
}
