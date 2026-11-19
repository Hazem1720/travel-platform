import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { HotelBookingsReaderService } from './hotel-bookings.reader.service';

// ACC-12: does the user still have a Confirmed hotel stay ahead?
describe('HotelBookingsReaderService.hasUpcomingConfirmed (ACC-12)', () => {
  const USER = '6735a1f4c1a2b3c4d5e6f001';
  // 5 Dec 2026, 09:30 UTC.
  const NOW = new Date('2026-12-05T09:30:00.000Z');

  function setup(found: unknown) {
    const bookings = { exists: jest.fn(async () => found) };
    return {
      reader: new HotelBookingsReaderService(bookings as any),
      bookings,
    };
  }

  it('looks for a Confirmed stay of this user whose check-out date has not passed', async () => {
    const { reader, bookings } = setup({ _id: 'r1' });
    await expect(reader.hasUpcomingConfirmed(USER, NOW)).resolves.toBe(true);
    expect(bookings.exists).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER),
      status: BookingStatus.CONFIRMED,
      // On the check-out day the stay still counts (HTL-23: "has passed").
      checkOut: { $gte: '2026-12-05' },
    });
  });

  it('answers false when there is none', async () => {
    const { reader } = setup(null);
    await expect(reader.hasUpcomingConfirmed(USER, NOW)).resolves.toBe(false);
  });

  it('answers false for an invalid id without querying', async () => {
    const { reader, bookings } = setup({ _id: 'r1' });
    await expect(reader.hasUpcomingConfirmed('not-an-id', NOW)).resolves.toBe(
      false,
    );
    expect(bookings.exists).not.toHaveBeenCalled();
  });
});
