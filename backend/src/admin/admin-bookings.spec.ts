import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { AdminBookingsService } from './admin-bookings.service';
import {
  AdminBookingsQueryDto,
  AdminBookingType,
} from './dto/admin-bookings.dto';

// ACC-17: every booking for admins, filterable by type, status and dates.
describe('Admin bookings list (ACC-17)', () => {
  function setup(
    result: unknown[] = [{ data: [{ _id: 'b1' }], total: [{ n: 11 }] }],
  ) {
    const make = () => ({
      aggregate: jest.fn<Promise<unknown[]>, [any[]]>(async () => result),
      collection: { name: 'hotelbookings' },
    });
    const flights = make();
    const hotels = make();
    return {
      service: new AdminBookingsService(flights as any, hotels as any),
      flights,
      hotels,
    };
  }
  const q = (extra: Partial<AdminBookingsQueryDto> = {}) =>
    ({ page: 1, limit: 10, ...extra }) as AdminBookingsQueryDto;

  it('both types: flights plus hotels through $unionWith, newest first, paged', async () => {
    const { service, flights, hotels } = setup();
    const result = await service.list(q({ page: 2 }));
    expect(hotels.aggregate).not.toHaveBeenCalled();
    const pipeline = flights.aggregate.mock.calls[0][0];
    expect(pipeline[0].$project.type).toEqual({ $literal: 'flight' });
    expect(pipeline[1].$unionWith.coll).toBe('hotelbookings');
    expect(pipeline[1].$unionWith.pipeline[0].$project.type).toEqual({
      $literal: 'hotel',
    });
    expect(pipeline[2]).toEqual({ $match: {} });
    const data = pipeline[3].$facet.data;
    expect(data[0]).toEqual({ $sort: { createdAt: -1, _id: -1 } });
    expect(data[1]).toEqual({ $skip: 10 });
    expect(data[2]).toEqual({ $limit: 10 });
    expect(pipeline[3].$facet.total).toEqual([{ $count: 'n' }]);
    expect(result).toEqual({
      data: [{ _id: 'b1' }],
      meta: { page: 2, limit: 10, total: 11, totalPages: 2 },
    });
  });

  it('type=flight reads only flights; type=hotel only hotels', async () => {
    const a = setup();
    await a.service.list(q({ type: AdminBookingType.FLIGHT }));
    const fp = a.flights.aggregate.mock.calls[0][0];
    expect(fp.some((s: any) => s.$unionWith)).toBe(false);
    expect(a.hotels.aggregate).not.toHaveBeenCalled();

    const b = setup();
    await b.service.list(q({ type: AdminBookingType.HOTEL }));
    const hp = b.hotels.aggregate.mock.calls[0][0];
    expect(hp[0].$project.type).toEqual({ $literal: 'hotel' });
    expect(hp.some((s: any) => s.$unionWith)).toBe(false);
    expect(b.flights.aggregate).not.toHaveBeenCalled();
  });

  it('filters by status and by travel date range', async () => {
    const { service, flights } = setup();
    await service.list(
      q({
        status: BookingStatus.CANCELLED,
        from: '2026-12-01',
        to: '2026-12-31',
      }),
    );
    expect(flights.aggregate.mock.calls[0][0][2]).toEqual({
      $match: {
        status: 'Cancelled',
        startDate: { $gte: '2026-12-01', $lte: '2026-12-31' },
      },
    });
  });

  it('only one end of the range is fine', async () => {
    const { service, flights } = setup();
    await service.list(q({ from: '2026-12-01' }));
    expect(flights.aggregate.mock.calls[0][0][2]).toEqual({
      $match: { startDate: { $gte: '2026-12-01' } },
    });
  });

  it('from after to is 400 and reads nothing', async () => {
    const { service, flights } = setup();
    await expect(
      service.list(q({ from: '2026-12-31', to: '2026-12-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(flights.aggregate).not.toHaveBeenCalled();
  });

  it('no bookings at all gives an empty page', async () => {
    const { service } = setup([{ data: [], total: [] }]);
    await expect(service.list(q())).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    });
  });

  it('validates the query: type, status, YYYY-MM-DD dates, limit, no sort', async () => {
    const props = async (body: object) =>
      (
        await validate(plainToInstance(AdminBookingsQueryDto, body), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((e) => e.property);
    expect(
      await props({
        type: 'hotel',
        status: 'Confirmed',
        from: '2026-12-01',
        to: '2026-12-31',
      }),
    ).toEqual([]);
    expect(await props({ type: 'train' })).toEqual(['type']);
    expect(await props({ status: 'Paid' })).toEqual(['status']);
    expect(await props({ from: '01/12/2026' })).toEqual(['from']);
    expect(await props({ limit: '11' })).toEqual(['limit']);
    expect(await props({ sort: 'createdAt:asc' })).toEqual(['sort']);
  });
});
