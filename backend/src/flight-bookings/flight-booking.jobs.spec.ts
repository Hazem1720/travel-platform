import { BookingStatus } from '../common/enums/booking-status.enum';
import { FlightBookingJobs } from './flight-booking.jobs';

// GEN-11 jobs with mocks; the real query runs in test/flight-hold.e2e-spec.ts.
describe('FlightBookingJobs (GEN-11)', () => {
  function setup(fail = false) {
    const bookings = {
      updateMany: jest.fn(async () => {
        if (fail) throw new Error('db down');
        return { modifiedCount: 2 };
      }),
    };
    const holds = {
      releaseExpiredHolds: jest.fn(async () => {
        if (fail) throw new Error('db down');
      }),
    };
    return {
      jobs: new FlightBookingJobs(bookings as any, holds as any),
      bookings,
      holds,
    };
  }

  it('expires every due hold', async () => {
    const { jobs, holds } = setup();
    await jobs.expireHolds();
    expect(holds.releaseExpiredHolds).toHaveBeenCalledWith();
  });

  it('completes Confirmed bookings with no segment still to land', async () => {
    const { jobs, bookings } = setup();
    const now = new Date('2026-12-10T00:00:00Z');
    await expect(jobs.completeLanded(now)).resolves.toBe(2);
    expect(bookings.updateMany).toHaveBeenCalledWith(
      {
        status: BookingStatus.CONFIRMED,
        segments: { $not: { $elemMatch: { arrivalAt: { $gt: now } } } },
      },
      { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
    );
  });

  it('never throws out of a job run', async () => {
    const { jobs } = setup(true);
    jest
      .spyOn((jobs as any).logger, 'error')
      .mockImplementation(() => undefined);
    await expect(jobs.expireHolds()).resolves.toBeUndefined();
    await expect(jobs.completeLanded()).resolves.toBe(0);
  });
});
