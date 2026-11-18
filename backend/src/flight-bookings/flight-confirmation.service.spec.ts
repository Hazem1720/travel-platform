import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BOOKING_REFERENCE,
  BookingStatus,
} from '../common/enums/booking-status.enum';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { CabinCategory } from '../flights/schemas/flight.schema';
import { PassengerType } from './flight-booking.rules';
import { renderETicket } from './e-ticket.pdf';
import { FlightConfirmationService } from './flight-confirmation.service';

// FLT-23 with mocked models, for CI. The full flow (hold, pay, confirm)
// runs against MongoDB in test/flight-hold.e2e-spec.ts.
describe('FlightConfirmationService (FLT-23)', () => {
  const USER = new Types.ObjectId();
  const FLIGHT = new Types.ObjectId();
  const CABIN = new Types.ObjectId();

  function booking(status: BookingStatus, extra: object = {}) {
    return {
      _id: new Types.ObjectId(),
      userId: USER,
      status,
      reference: status === BookingStatus.CONFIRMED ? 'FL-ABCD1234' : null,
      segments: [
        {
          flightId: FLIGHT,
          cabinId: CABIN,
          flightNumber: 'NP101',
          from: 'CAI',
          to: 'DXB',
          departureAt: new Date('2026-12-01T22:30:00Z'),
          arrivalAt: new Date('2026-12-02T02:30:00Z'),
          cabin: CabinCategory.ECONOMY,
          seats: 2,
        },
      ],
      passengers: [
        {
          type: PassengerType.ADULT,
          fullName: 'Sara Ali',
          extraBags: [{ weightKg: 20 }],
        },
        { type: PassengerType.CHILD, fullName: 'Omar Ali', extraBags: [] },
      ],
      totalAmount: 45000,
      confirmedAt: new Date('2026-11-18T12:00:00Z'),
      ...extra,
    };
  }

  function setup(
    found: any,
    opts: { winner?: boolean; notifyFails?: boolean } = {},
  ) {
    let current = found;
    const bookings = {
      findById: jest.fn(() => ({
        lean: () => ({ exec: async () => current }),
      })),
      findOneAndUpdate: jest.fn((_f: any, update: any) => ({
        lean: async () => {
          if (opts.winner === false) {
            current = { ...current, status: BookingStatus.EXPIRED };
            return null;
          }
          return { ...current, ...update.$set };
        },
      })),
    };
    const flights = { updateOne: jest.fn(async () => ({ modifiedCount: 1 })) };
    const airports = {
      find: () => ({
        lean: async () => [
          { _id: 'CAI', timeZone: 'Africa/Cairo' },
          { _id: 'DXB', timeZone: 'Asia/Dubai' },
        ],
      }),
    };
    const notifications = {
      create: jest.fn(async () => {
        if (opts.notifyFails) throw new Error('down');
      }),
    };
    const service = new FlightConfirmationService(
      bookings as any,
      flights as any,
      airports as any,
      notifications as any,
    );
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
    return { service, bookings, flights, notifications };
  }

  it('PendingPayment -> Confirmed with an FL- reference, held seats -> booked, notified', async () => {
    const b = booking(BookingStatus.PENDING_PAYMENT);
    const { service, bookings, flights, notifications } = setup(b);
    await service.confirm(String(b._id));

    const [filter, update] = (bookings.findOneAndUpdate.mock.calls as any[])[0];
    expect(filter).toEqual({
      _id: b._id,
      status: BookingStatus.PENDING_PAYMENT,
    });
    expect(update.$set.status).toBe(BookingStatus.CONFIRMED);
    expect(update.$set.reference).toMatch(BOOKING_REFERENCE);
    expect(update.$set.reference.startsWith('FL-')).toBe(true);
    expect(update.$set.expiresAt).toBeNull();

    expect(flights.updateOne).toHaveBeenCalledWith(
      { _id: FLIGHT },
      { $inc: { 'cabins.$[c].heldSeats': -2, 'cabins.$[c].bookedSeats': 2 } },
      { arrayFilters: [{ 'c._id': CABIN }] },
    );
    expect(notifications.create).toHaveBeenCalledWith(
      USER,
      NotificationType.BOOKING_CONFIRMED,
      expect.stringContaining('NP101 CAI-DXB'),
      expect.objectContaining({ bookingId: String(b._id) }),
    );
  });

  it('a second call for a Confirmed booking changes nothing', async () => {
    const { service, bookings, flights } = setup(
      booking(BookingStatus.CONFIRMED),
    );
    await service.confirm(String(new Types.ObjectId()));
    expect(bookings.findOneAndUpdate).not.toHaveBeenCalled();
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('an Expired booking cannot be confirmed: 409, so Payments can refund', async () => {
    const { service, flights } = setup(booking(BookingStatus.EXPIRED));
    await expect(
      service.confirm(String(new Types.ObjectId())),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('expired at the same moment it was paid: 409 and no seats moved', async () => {
    const { service, flights } = setup(booking(BookingStatus.PENDING_PAYMENT), {
      winner: false,
    });
    await expect(
      service.confirm(String(new Types.ObjectId())),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(flights.updateOne).not.toHaveBeenCalled();
  });

  it('a failed notification does not undo the paid booking', async () => {
    const { service, flights } = setup(booking(BookingStatus.PENDING_PAYMENT), {
      notifyFails: true,
    });
    await expect(
      service.confirm(String(new Types.ObjectId())),
    ).resolves.toBeUndefined();
    expect(flights.updateOne).toHaveBeenCalled();
  });

  it('shows the owner the booking with local times; anyone else 404', async () => {
    const b = booking(BookingStatus.CONFIRMED);
    const { service } = setup(b);
    const view = await service.getForOwner(String(USER), String(b._id));
    expect(view.segments[0].departure).toMatchObject({
      local: '2026-12-02T00:30',
      timeZone: 'Africa/Cairo',
    });
    expect(view.segments[0].arrival).toMatchObject({
      local: '2026-12-02T06:30',
      timeZone: 'Asia/Dubai',
    });
    await expect(
      service.getForOwner(String(new Types.ObjectId()), String(b._id)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('e-ticket: 400 for a PendingPayment booking', async () => {
    const { service } = setup(booking(BookingStatus.PENDING_PAYMENT));
    await expect(
      service.getTicketData(String(USER), String(new Types.ObjectId())),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('e-ticket PDF shows the reference, flight, local times and names', async () => {
    const { service } = setup(booking(BookingStatus.CONFIRMED));
    const view = await service.getTicketData(
      String(USER),
      String(new Types.ObjectId()),
    );
    const pdf = await renderETicket(view, { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // pdfkit writes text as hex strings, split for kerning: join them.
    const text = (pdf.toString('latin1').match(/<([0-9a-f]+)>/g) ?? [])
      .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
      .join('');
    for (const s of [
      'FL-ABCD1234',
      'NP101',
      '2026-12-02 00:30',
      '2026-12-02 06:30',
      'Sara Ali',
      'Omar Ali',
      'USD 450.00',
    ]) {
      expect(text).toContain(s);
    }
  });
});
