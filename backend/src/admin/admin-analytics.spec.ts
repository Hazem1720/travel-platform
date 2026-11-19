import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AdminAnalyticsService } from './admin-analytics.service';

const air = new Types.ObjectId();
const hotel = new Types.ObjectId();

function setup(flightRows: any[], hotelRows: any[]) {
  const pipelines: Record<string, any[]> = {};
  const connection: any = {
    collection: (name: string) => ({
      aggregate: (p: any[]) => {
        pipelines[name] = p;
        return {
          toArray: async () =>
            name === 'flightbookings' ? flightRows : hotelRows,
        };
      },
      find: () => ({
        toArray: async () =>
          name === 'airlines'
            ? [{ _id: air, name: 'Nile Air', code: 'NP' }]
            : [{ _id: hotel, name: 'Nile View' }],
      }),
    }),
  };
  return { service: new AdminAnalyticsService(connection), pipelines };
}

describe('BON-01: admin analytics', () => {
  it('sums bookings and revenue per provider, minus refunds, in whole cents', async () => {
    const { service, pipelines } = setup(
      [
        {
          _id: air,
          bookings: 2,
          cancelled: 1,
          grossRevenue: 50000,
          refunded: 10000.4,
        },
      ],
      [
        {
          _id: hotel,
          bookings: 1,
          cancelled: 0,
          grossRevenue: 45000,
          refunded: 0,
        },
      ],
    );
    const res = await service.summary({ from: '2026-11-01', to: '2026-11-30' });
    expect(res.totals).toEqual({
      bookings: 3,
      cancelled: 1,
      grossRevenue: 95000,
      refunded: 10000,
      revenue: 85000,
    });
    expect(res.airlines[0]).toMatchObject({
      name: 'Nile Air',
      code: 'NP',
      revenue: 40000,
    });
    expect(res.hotels[0]).toMatchObject({ name: 'Nile View', revenue: 45000 });
    const match = pipelines.flightbookings[0].$match;
    expect(match.createdAt).toEqual({
      $gte: new Date('2026-11-01T00:00:00Z'),
      $lt: new Date('2026-12-01T00:00:00Z'),
    });
    expect(match.status.$in).toEqual(['Confirmed', 'Completed', 'Cancelled']);
  });

  it('defaults to the last 30 days and refuses from after to', async () => {
    const { service } = setup([], []);
    const res = await service.summary({ to: '2026-11-30' });
    expect(res.from).toBe('2026-11-01');
    expect(res.totals.revenue).toBe(0);
    await expect(
      service.summary({ from: '2026-12-02', to: '2026-12-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
