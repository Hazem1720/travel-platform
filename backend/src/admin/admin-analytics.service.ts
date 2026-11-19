import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { platformCurrency } from '../common/helpers/money';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

const DAY = 86_400_000;
const PAID = ['Confirmed', 'Completed', 'Cancelled'];
const ACTIVE = ['Confirmed', 'Completed'];

export interface ProviderStats {
  providerId: string;
  name: string;
  code?: string;
  // Confirmed and Completed bookings made in the period.
  bookings: number;
  // Paid bookings cancelled since (they still count in grossRevenue).
  cancelled: number;
  // USD cents: everything paid for the period's bookings (Succeeded
  // payments, fare differences of flight changes included).
  grossRevenue: number;
  // USD cents: refunds issued or pending for them (failed ones excluded).
  refunded: number;
  // grossRevenue - refunded.
  revenue: number;
}

// BON-01 (bonus): bookings and revenue per airline and per hotel for the
// bookings made in a period. Only reads: one aggregation per booking
// collection, with its payments and refunds looked up. A round trip with
// two airlines counts for both; what was paid and refunded is shared by
// the segments' prices.
@Injectable()
export class AdminAnalyticsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async summary(q: AnalyticsQueryDto) {
    const { from, to, start, end } = this.period(q);
    const [airlines, hotels] = await Promise.all([
      this.flightStats(start, end),
      this.hotelStats(start, end),
    ]);
    const all = [...airlines, ...hotels];
    const sum = (k: keyof ProviderStats) =>
      all.reduce((n, p) => n + (p[k] as number), 0);
    return {
      from,
      to,
      currency: platformCurrency(),
      totals: {
        bookings: sum('bookings'),
        cancelled: sum('cancelled'),
        grossRevenue: sum('grossRevenue'),
        refunded: sum('refunded'),
        revenue: sum('revenue'),
      },
      airlines,
      hotels,
    };
  }

  // Whole UTC days, "to" included; default the last 30 days.
  private period(q: AnalyticsQueryDto) {
    const today = new Date().toISOString().slice(0, 10);
    const to = q.to ?? today;
    const from =
      q.from ??
      new Date(Date.parse(`${to}T00:00:00Z`) - 29 * DAY)
        .toISOString()
        .slice(0, 10);
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(Date.parse(`${to}T00:00:00Z`) + DAY);
    if (start >= end) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'from must not be after to',
        details: { from: ['from must not be after to'] },
      });
    }
    return { from, to, start, end };
  }

  // What was actually paid for each booking: its Succeeded payments, plus
  // those of its flight changes (FLT-27, parentBookingId).
  private paymentLookup(type: 'flight' | 'hotel') {
    return {
      $lookup: {
        from: 'payments',
        let: { id: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$status', 'Succeeded'] },
                  {
                    $or: [
                      {
                        $and: [
                          { $eq: ['$bookingId', '$$id'] },
                          { $eq: ['$bookingType', type] },
                        ],
                      },
                      { $eq: ['$parentBookingId', '$$id'] },
                    ],
                  },
                ],
              },
            },
          },
          { $group: { _id: null, amount: { $sum: '$amount' } } },
        ],
        as: 'paid',
      },
    };
  }

  // Refunds of each booking, not counting failed ones.
  private refundLookup(type: 'flight' | 'hotel') {
    return {
      $lookup: {
        from: 'refunds',
        let: { id: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$bookingId', '$$id'] },
                  { $eq: ['$bookingType', type] },
                  { $ne: ['$status', 'Failed'] },
                ],
              },
            },
          },
          { $group: { _id: null, amount: { $sum: '$amount' } } },
        ],
        as: 'refunds',
      },
    };
  }

  private async flightStats(start: Date, end: Date): Promise<ProviderStats[]> {
    const rows = await this.connection
      .collection('flightbookings')
      .aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
            status: { $in: PAID },
          },
        },
        this.paymentLookup('flight'),
        this.refundLookup('flight'),
        {
          $addFields: {
            paidTotal: { $ifNull: [{ $arrayElemAt: ['$paid.amount', 0] }, 0] },
            refundedTotal: {
              $ifNull: [{ $arrayElemAt: ['$refunds.amount', 0] }, 0],
            },
          },
        },
        { $unwind: '$segments' },
        {
          $group: {
            _id: { airline: '$segments.airlineId', booking: '$_id' },
            status: { $first: '$status' },
            totalAmount: { $first: '$totalAmount' },
            paidTotal: { $first: '$paidTotal' },
            refundedTotal: { $first: '$refundedTotal' },
            subtotal: { $sum: '$segments.subtotal' },
          },
        },
        // This airline's share of the booking: its segments' prices.
        {
          $addFields: {
            share: {
              $cond: [
                { $gt: ['$totalAmount', 0] },
                { $divide: ['$subtotal', '$totalAmount'] },
                0,
              ],
            },
          },
        },
        {
          $group: {
            _id: '$_id.airline',
            bookings: {
              $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] },
            },
            grossRevenue: { $sum: { $multiply: ['$paidTotal', '$share'] } },
            refunded: { $sum: { $multiply: ['$refundedTotal', '$share'] } },
          },
        },
      ])
      .toArray();
    const names = await this.names(
      'airlines',
      rows.map((r) => r._id),
    );
    return this.finish(rows, names);
  }

  private async hotelStats(start: Date, end: Date): Promise<ProviderStats[]> {
    const rows = await this.connection
      .collection('hotelbookings')
      .aggregate([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
            status: { $in: PAID },
          },
        },
        this.paymentLookup('hotel'),
        this.refundLookup('hotel'),
        {
          $group: {
            _id: '$hotelId',
            bookings: {
              $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] },
            },
            grossRevenue: {
              $sum: { $ifNull: [{ $arrayElemAt: ['$paid.amount', 0] }, 0] },
            },
            refunded: {
              $sum: {
                $ifNull: [{ $arrayElemAt: ['$refunds.amount', 0] }, 0],
              },
            },
          },
        },
      ])
      .toArray();
    const names = await this.names(
      'hotels',
      rows.map((r) => r._id),
    );
    return this.finish(rows, names);
  }

  private async names(collection: string, ids: unknown[]) {
    const docs = await this.connection
      .collection(collection)
      .find(
        { _id: { $in: ids as Types.ObjectId[] } },
        { projection: { name: 1, code: 1 } },
      )
      .toArray();
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  // Whole cents, sorted by revenue, highest first.
  private finish(
    rows: Record<string, any>[],
    names: Map<string, Record<string, any>>,
  ): ProviderStats[] {
    return rows
      .map((r) => {
        const p = names.get(String(r._id));
        const grossRevenue = Math.round(r.grossRevenue);
        const refunded = Math.round(r.refunded);
        return {
          providerId: String(r._id),
          name: String(p?.name ?? '(deleted provider)'),
          ...(p?.code ? { code: String(p.code) } : {}),
          bookings: r.bookings,
          cancelled: r.cancelled,
          grossRevenue,
          refunded,
          revenue: grossRevenue - refunded,
        };
      })
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  }
}
