import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { HotelBookingsReaderService } from './hotel-bookings.reader.service';

// ACC-12: does the user still have a Confirmed hotel stay ahead?
describe('HotelBookingsReaderService.hasUpcomingConfirmed (ACC-12)', () => {
  const USER = '6735a1f4c1a2b3c4d5e6f001';

  function setup(found: unknown) {
    const bookings = { exists: jest.fn(async () => found) };
    return {
      reader: new HotelBookingsReaderService(bookings as any),
      bookings,
    };
  }

  it('looks for a Confirmed stay of this user, with no UTC date', async () => {
    const { reader, bookings } = setup({ _id: 'r1' });
    await expect(reader.hasUpcomingConfirmed(USER)).resolves.toBe(true);
    // A stay stays Confirmed until its check-out date has passed in the
    // hotel's city (HotelStayCompletionJob), so the status is the answer.
    expect(bookings.exists).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER),
      status: BookingStatus.CONFIRMED,
    });
  });

  it('answers false when there is none', async () => {
    const { reader } = setup(null);
    await expect(reader.hasUpcomingConfirmed(USER)).resolves.toBe(false);
  });

  it('answers false for an invalid id without querying', async () => {
    const { reader, bookings } = setup({ _id: 'r1' });
    await expect(reader.hasUpcomingConfirmed('not-an-id')).resolves.toBe(false);
    expect(bookings.exists).not.toHaveBeenCalled();
  });
});
