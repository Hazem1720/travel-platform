import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { summarizeByCurrency } from './budget.summary';
import { ItinerariesService } from './itineraries.service';
import { ItineraryBookingsService } from './itinerary-bookings.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
} from './itinerary.fixtures-spec';
import { LinkedBookingType } from './schemas/itinerary.schema';

const hotelId = new Types.ObjectId();
const flightId = new Types.ObjectId();
const lean = (v: unknown) => ({ lean: async () => v });

function setup(opts: { hotel?: any; flight?: any } = {}) {
  const doc: any = {
    ...itinerary([day('cairo'), day('luxor')]),
    linkedBookings: [],
  };
  const itineraries = {
    findById: jest.fn<any, any[]>(() => lean(doc)),
    findOneAndUpdate: jest.fn<any, any[]>((filter: any, update: any) => {
      const dayOk =
        !filter['days._id'] ||
        doc.days.some((d: any) => String(d._id) === String(filter['days._id']));
      const dup = filter['linkedBookings.bookingId']
        ? doc.linkedBookings.some(
            (b: any) =>
              String(b.bookingId) ===
              String(filter['linkedBookings.bookingId'].$ne),
          )
        : false;
      if (!dayOk || dup) return lean(null);
      if (update.$push) {
        doc.linkedBookings = [
          ...doc.linkedBookings,
          { _id: new Types.ObjectId(), ...update.$push.linkedBookings },
        ];
      }
      if (update.$pull) {
        doc.linkedBookings = doc.linkedBookings.filter(
          (b: any) => String(b._id) !== String(update.$pull.linkedBookings._id),
        );
      }
      return lean({ ...doc });
    }),
  };
  const ownedBy = (b: any) => (f: any) =>
    lean(
      b &&
        String(f.userId) === String(b.userId) &&
        String(f._id) === String(b._id)
        ? b
        : null,
    );
  const hotelBookings = {
    findOne: jest.fn<any, any[]>((f: any) => ownedBy(opts.hotel)(f)),
  };
  const flightBookings = {
    findOne: jest.fn<any, any[]>((f: any) => ownedBy(opts.flight)(f)),
  };
  const service = new ItineraryBookingsService(
    new ItinerariesService(itineraries as any, {} as any),
    itineraries as any,
    flightBookings as any,
    hotelBookings as any,
  );
  return { service, doc };
}

const hotel = (status = BookingStatus.CONFIRMED) => ({
  _id: hotelId,
  userId: new Types.ObjectId(OWNER.id),
  status,
  reference: 'HT-ABCD1234',
  hotelName: 'Nile Hotel',
  checkIn: '2026-12-02',
  checkOut: '2026-12-04',
  totalAmount: 45000,
  currency: 'USD',
});
const flight = {
  _id: flightId,
  userId: new Types.ObjectId(OWNER.id),
  status: BookingStatus.COMPLETED,
  reference: 'FL-ABCD1234',
  segments: [{ flightNumber: 'NP101', from: 'CAI', to: 'LXR' }],
  totalAmount: 12050,
  currency: 'USD',
};

describe('ITN-27: link bookings to itinerary days', () => {
  it('links my Confirmed hotel booking to day 2; it counts under Accommodation', async () => {
    const { service, doc } = setup({ hotel: hotel() });
    const day2 = String(doc.days[1]._id);
    const res = await service.link(OWNER, ITN_ID, {
      type: LinkedBookingType.HOTEL,
      bookingId: String(hotelId),
      dayId: day2,
    });
    expect(res.linkedBookings).toEqual([
      expect.objectContaining({
        type: 'hotel',
        dayNumber: 2,
        reference: 'HT-ABCD1234',
        label: 'Nile Hotel, 2026-12-02 to 2026-12-04',
        amount: 450,
        currency: 'USD',
      }),
    ]);
    expect(res.budget.byCategory.accommodation).toEqual({ USD: 450 });
    expect(res.budget.byDay[1].total).toEqual({ USD: 450 });
    expect(res.budget.total).toEqual({ USD: 450 });
  });

  it('a flight counts under Intercity transport', async () => {
    const { service, doc } = setup({ flight });
    const res = await service.link(OWNER, ITN_ID, {
      type: LinkedBookingType.FLIGHT,
      bookingId: String(flightId),
      dayId: String(doc.days[0]._id),
    });
    expect(res.linkedBookings[0].label).toBe('NP101 CAI-LXR');
    expect(res.budget.byCategory.intercity_transport).toEqual({ USD: 120.5 });
  });

  it("is 404 for another user's booking or itinerary, or an unknown day", async () => {
    const other = { ...hotel(), userId: new Types.ObjectId(STRANGER.id) };
    const { service, doc } = setup({ hotel: other });
    const dto = {
      type: LinkedBookingType.HOTEL,
      bookingId: String(hotelId),
      dayId: String(doc.days[0]._id),
    };
    await expect(service.link(OWNER, ITN_ID, dto)).rejects.toThrow(
      'Booking not found',
    );
    await expect(service.link(STRANGER, ITN_ID, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.link(OWNER, ITN_ID, {
        ...dto,
        dayId: String(new Types.ObjectId()),
      }),
    ).rejects.toThrow('Day not found');
  });

  it('is 400 for a booking that is not Confirmed or Completed', async () => {
    const { service, doc } = setup({
      hotel: hotel(BookingStatus.PENDING_PAYMENT),
    });
    await expect(
      service.link(OWNER, ITN_ID, {
        type: LinkedBookingType.HOTEL,
        bookingId: String(hotelId),
        dayId: String(doc.days[0]._id),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is 409 when the booking is already linked, and unlinking removes it from the budget', async () => {
    const { service, doc } = setup({ hotel: hotel() });
    const dto = {
      type: LinkedBookingType.HOTEL,
      bookingId: String(hotelId),
      dayId: String(doc.days[0]._id),
    };
    const first = await service.link(OWNER, ITN_ID, dto);
    await expect(service.link(OWNER, ITN_ID, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const res = await service.unlink(
      OWNER,
      ITN_ID,
      String(first.linkedBookings[0]._id),
    );
    expect(res.linkedBookings).toEqual([]);
    expect(res.budget.total).toEqual({});
    await expect(
      service.unlink(OWNER, ITN_ID, String(new Types.ObjectId())),
    ).rejects.toThrow('Linked booking not found');
  });

  it('ignores links to a deleted day in the budget', () => {
    const d = day('cairo');
    const summary = summarizeByCurrency({
      startDate: new Date('2026-12-01'),
      days: [d],
      linkedBookings: [
        { dayId: d._id, type: 'hotel', amount: 10, currency: 'USD' },
        {
          dayId: new Types.ObjectId(),
          type: 'flight',
          amount: 99,
          currency: 'USD',
        },
      ],
    });
    expect(summary.total).toEqual({ USD: 10 });
  });
});
