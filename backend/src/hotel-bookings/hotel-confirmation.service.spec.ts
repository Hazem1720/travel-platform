import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { NotificationType } from '../notifications/schemas/notification.schema';
import {
  HotelConfirmationService,
  RESERVATION_NOT_FOUND,
  ROOMS_RELEASED,
} from './hotel-confirmation.service';

// HTL-17: confirmation after a verified payment, and the confirmation page.
describe('HotelConfirmationService (HTL-17)', () => {
  const ID = new Types.ObjectId();
  const USER = new Types.ObjectId();
  const HOTEL = new Types.ObjectId();

  const reservation = (over: Record<string, unknown> = {}) => ({
    _id: ID,
    userId: USER,
    hotelId: HOTEL,
    hotelName: 'TEST Nile View',
    reference: null,
    status: BookingStatus.PENDING_PAYMENT,
    checkIn: '2026-12-05',
    checkOut: '2026-12-08',
    nights: 3,
    rooms: [{ name: '101' }, { name: '102' }],
    totalAmount: 120000,
    currency: 'USD',
    expiresAt: new Date(Date.now() + 5 * 60_000),
    ...over,
  });

  function setup(
    stored: Record<string, unknown> | null = reservation(),
    bookedNights = 6,
  ) {
    let doc = stored ? { ...stored } : null;
    const bookings = {
      findById: jest.fn(() => ({
        lean: () => ({ exec: async () => (doc ? { ...doc } : null) }),
      })),
      findOneAndUpdate: jest.fn((filter: any, update: any) => ({
        lean: async () => {
          if (!doc || doc.status !== filter.status) return null;
          doc = { ...doc, ...update.$set };
          return { ...doc };
        },
      })),
      updateOne: jest.fn(async (filter: any, update: any) => {
        if (!doc || doc.status !== filter.status) return { modifiedCount: 0 };
        doc = { ...doc, ...update.$set };
        return { modifiedCount: 1 };
      }),
    };
    const hotel = {
      _id: HOTEL,
      name: 'TEST Nile View',
      address: '12 Corniche El Nil',
      cityId: 'cairo',
      checkInTime: '14:00',
      checkOutTime: '12:00',
    };
    const hotels = { findById: jest.fn(() => ({ lean: async () => hotel })) };
    const availability = {
      confirmHeld: jest.fn(async () => bookedNights),
      countBooked: jest.fn(async () => bookedNights),
      releaseBooking: jest.fn(async () => 0),
    };
    const notifications = { create: jest.fn(async () => ({})) };
    const service = new HotelConfirmationService(
      bookings as any,
      hotels as any,
      availability as any,
      notifications as any,
    );
    return {
      service,
      bookings,
      availability,
      notifications,
      current: () => doc,
    };
  }

  describe('confirm (after a verified payment)', () => {
    it('Confirmed, an HT- reference, Held nights Booked, a notification', async () => {
      const { service, availability, notifications, current } = setup();
      await service.confirm(String(ID));

      const saved = current()!;
      expect(saved.status).toBe(BookingStatus.CONFIRMED);
      expect(saved.reference).toMatch(/^HT-[A-Z0-9]{8}$/);
      expect(saved.confirmedAt).toBeInstanceOf(Date);
      expect(saved.expiresAt).toBeNull();
      expect(availability.confirmHeld).toHaveBeenCalledWith(String(ID));
      expect(availability.releaseBooking).not.toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalledWith(
        USER,
        NotificationType.BOOKING_CONFIRMED,
        `Your hotel reservation ${String(saved.reference)} is confirmed: ` +
          'TEST Nile View, 2026-12-05 to 2026-12-08, 2 rooms',
        expect.objectContaining({
          bookingId: String(ID),
          reference: saved.reference,
        }),
      );
    });

    it('a second call (Stripe repeats the event) changes nothing', async () => {
      const { service, availability, notifications, current } = setup();
      await service.confirm(String(ID));
      const reference = current()!.reference;
      await service.confirm(String(ID));
      expect(current()!.reference).toBe(reference);
      expect(availability.confirmHeld).toHaveBeenCalledTimes(1);
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it.each([BookingStatus.EXPIRED, BookingStatus.CANCELLED])(
      'refuses a %s reservation with 409, so Payments refunds',
      async (status) => {
        const { service, availability } = setup(reservation({ status }));
        await expect(service.confirm(String(ID))).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(availability.confirmHeld).not.toHaveBeenCalled();
      },
    );

    it('refuses (409) and expires it when a night was taken after the hold ran out', async () => {
      // 2 rooms x 3 nights = 6, but only 5 are still this reservation's.
      const { service, availability, notifications, current } = setup(
        reservation(),
        5,
      );
      await expect(service.confirm(String(ID))).rejects.toThrow(
        new ConflictException(ROOMS_RELEASED),
      );
      expect(current()!.status).toBe(BookingStatus.EXPIRED);
      expect(current()!.reference).toBeNull();
      expect(availability.releaseBooking).toHaveBeenCalledWith(String(ID));
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('a failed notification never undoes the confirmation', async () => {
      const { service, notifications, current } = setup();
      notifications.create.mockRejectedValueOnce(new Error('down'));
      await expect(service.confirm(String(ID))).resolves.toBeUndefined();
      expect(current()!.status).toBe(BookingStatus.CONFIRMED);
    });

    it('404 for an unknown or invalid id', async () => {
      await expect(
        setup(null).service.confirm(String(new Types.ObjectId())),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(setup().service.confirm('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getForOwner (GET /hotel-bookings/:id)', () => {
    const user = (id: Types.ObjectId) =>
      ({ id: String(id), role: Role.USER }) as any;

    it("returns the owner's reservation with the hotel's address and times", async () => {
      const { service } = setup(
        reservation({
          status: BookingStatus.CONFIRMED,
          reference: 'HT-ABCD1234',
        }),
      );
      const view = await service.getForOwner(user(USER), String(ID));
      expect(view).toMatchObject({
        reference: 'HT-ABCD1234',
        status: BookingStatus.CONFIRMED,
        hotel: {
          address: '12 Corniche El Nil',
          checkInTime: '14:00',
          checkOutTime: '12:00',
        },
      });
    });

    it("answers 404 for another user's reservation and for an unknown id", async () => {
      const { service } = setup();
      await expect(
        service.getForOwner(user(new Types.ObjectId()), String(ID)),
      ).rejects.toThrow(new NotFoundException(RESERVATION_NOT_FOUND));
      await expect(
        setup(null).service.getForOwner(user(USER), String(ID)),
      ).rejects.toThrow(new NotFoundException(RESERVATION_NOT_FOUND));
    });
  });
});
