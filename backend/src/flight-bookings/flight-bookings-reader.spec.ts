import { Types } from 'mongoose';
import { FlightBookingsReaderService } from './flight-bookings.reader.service';

// FLT-05, ACC-12: the read-only questions other modules ask about flight
// bookings. An id that is not an ObjectId answers "no" without a query.
describe('FlightBookingsReaderService (FLT-05, ACC-12)', () => {
  function setup() {
    const bookings = {
      exists: jest.fn(async () => ({ _id: 'b1' })),
      distinct: jest.fn(async () => [new Types.ObjectId()]),
    };
    return {
      bookings,
      reader: new FlightBookingsReaderService(bookings as any),
    };
  }

  it('answers no, without a query, for ids that are not ObjectIds', async () => {
    const { reader, bookings } = setup();
    await expect(reader.hasBookings('x')).resolves.toBe(false);
    await expect(reader.confirmedUserIds('x')).resolves.toEqual([]);
    await expect(reader.hasUpcomingConfirmed('x')).resolves.toBe(false);
    expect(bookings.exists).not.toHaveBeenCalled();
    expect(bookings.distinct).not.toHaveBeenCalled();
  });

  it('asks for any booking on the flight, in any status', async () => {
    const { reader, bookings } = setup();
    const id = new Types.ObjectId();
    await expect(reader.hasBookings(id)).resolves.toBe(true);
    expect(bookings.exists).toHaveBeenCalledWith({ 'segments.flightId': id });
    bookings.exists.mockResolvedValueOnce(null as any);
    await expect(reader.hasBookings(String(id))).resolves.toBe(false);
  });

  it('lists each Confirmed passenger once for a schedule change', async () => {
    const { reader, bookings } = setup();
    const id = new Types.ObjectId();
    await reader.confirmedUserIds(String(id));
    expect(bookings.distinct).toHaveBeenCalledWith('userId', {
      'segments.flightId': id,
      status: 'Confirmed',
    });
  });

  it('counts only Confirmed bookings with a segment still in the future', async () => {
    const { reader, bookings } = setup();
    const user = new Types.ObjectId();
    const now = new Date('2026-11-20T10:00:00Z');
    bookings.exists.mockResolvedValueOnce(null as any);
    await expect(reader.hasUpcomingConfirmed(user, now)).resolves.toBe(false);
    expect(bookings.exists).toHaveBeenCalledWith({
      userId: user,
      status: 'Confirmed',
      segments: { $elemMatch: { departureAt: { $gt: now } } },
    });
  });
});
