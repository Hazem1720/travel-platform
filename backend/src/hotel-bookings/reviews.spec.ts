import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { HotelStayCompletionJob } from './hotel-stay-completion.job';
import {
  REVIEW_ALREADY_EXISTS,
  REVIEW_NOT_COMPLETED,
  ReviewsService,
} from './reviews.service';

const lean = (value: unknown) => ({ lean: async () => value });

// HTL-23 and HTL-24: ratings and reviews of Completed stays.
describe('Hotel reviews (HTL-23, HTL-24)', () => {
  const owner: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f001',
    role: Role.USER,
    assignedProviderId: null,
  };
  const stranger: AuthUser = { ...owner, id: '6735a1f4c1a2b3c4d5e6f002' };
  const HOTEL = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f801');
  const BOOKING = new Types.ObjectId('6736f0a1c1a2b3c4d5e6fa10');
  const REVIEW = new Types.ObjectId('6737a1f4c1a2b3c4d5e6f101');

  function setup(
    opts: {
      booking?: unknown;
      review?: unknown;
      hotel?: unknown;
      stats?: unknown[];
      createFails?: unknown;
      rows?: unknown[];
      users?: unknown[];
    } = {},
  ) {
    const booking =
      'booking' in opts
        ? opts.booking
        : {
            _id: BOOKING,
            userId: new Types.ObjectId(owner.id),
            hotelId: HOTEL,
            status: BookingStatus.COMPLETED,
          };
    const review =
      'review' in opts
        ? opts.review
        : {
            _id: REVIEW,
            hotelId: HOTEL,
            userId: new Types.ObjectId(owner.id),
            rating: 4,
            text: 'Nice',
          };
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn(async () => opts.rows ?? []),
    };
    const reviews = {
      create: jest.fn(async (doc: any) => {
        if (opts.createFails) throw opts.createFails;
        return { toObject: () => ({ _id: REVIEW, ...doc }) };
      }),
      findById: jest.fn(() => lean(review)),
      findByIdAndUpdate: jest.fn((_id: unknown, u: any) =>
        lean({ ...(review as object), ...u.$set }),
      ),
      deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
      aggregate: jest.fn(async () => opts.stats ?? []),
      find: jest.fn<typeof findChain, any[]>(() => findChain),
      countDocuments: jest.fn(async () => (opts.rows ?? []).length),
    };
    const bookings = { findById: jest.fn(() => lean(booking)) };
    const hotels = {
      findById: jest.fn(() =>
        lean(
          'hotel' in opts
            ? opts.hotel
            : {
                _id: HOTEL,
                isActive: true,
                ratingAverage: 4.5,
                ratingCount: 2,
              },
        ),
      ),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const users = {
      find: jest.fn(() => ({ toArray: async () => opts.users ?? [] })),
    };
    const connection = { collection: jest.fn(() => users) };
    const service = new ReviewsService(
      reviews as any,
      bookings as any,
      hotels as any,
      connection as any,
    );
    return { service, reviews, bookings, hotels, findChain };
  }

  describe('writing a review (HTL-23)', () => {
    it('saves one rating and text for my Completed reservation and updates the hotel average', async () => {
      const { service, reviews, hotels } = setup({
        stats: [{ average: 4.333, count: 3 }],
      });
      const saved = await service.create(owner, String(BOOKING), {
        rating: 5,
        text: 'Lovely stay',
      });
      expect(reviews.create).toHaveBeenCalledWith({
        hotelId: HOTEL,
        bookingId: BOOKING,
        userId: new Types.ObjectId(owner.id),
        rating: 5,
        text: 'Lovely stay',
      });
      expect(saved).toMatchObject({ rating: 5, text: 'Lovely stay' });
      // Rounded to one decimal.
      expect(hotels.updateOne).toHaveBeenCalledWith(
        { _id: HOTEL },
        { $set: { ratingAverage: 4.3, ratingCount: 3 } },
      );
    });

    it('a rating without text is allowed', async () => {
      const { service, reviews } = setup();
      await service.create(owner, String(BOOKING), { rating: 3 });
      expect(reviews.create.mock.calls[0][0]).toMatchObject({ text: '' });
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
    ])('refuses a %s reservation with 409', async (status) => {
      const { service, reviews } = setup({
        booking: {
          _id: BOOKING,
          userId: new Types.ObjectId(owner.id),
          hotelId: HOTEL,
          status,
        },
      });
      const err = await service
        .create(owner, String(BOOKING), { rating: 5 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(REVIEW_NOT_COMPLETED);
      expect(reviews.create).not.toHaveBeenCalled();
    });

    it('a second review of the same reservation is 409', async () => {
      const { service, hotels } = setup({ createFails: { code: 11000 } });
      const err = await service
        .create(owner, String(BOOKING), { rating: 5 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toBe(REVIEW_ALREADY_EXISTS);
      expect(hotels.updateOne).not.toHaveBeenCalled();
    });

    it("another user's reservation, a missing one or a bad id is 404", async () => {
      const { service } = setup();
      await expect(
        service.create(stranger, String(BOOKING), { rating: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup({ booking: null }).service.create(owner, String(BOOKING), {
          rating: 5,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.create(owner, 'not-an-id', { rating: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('editing and deleting (HTL-23)', () => {
    it('edits my review and recalculates when the rating changes', async () => {
      const { service, reviews, hotels } = setup({
        stats: [{ average: 2, count: 1 }],
      });
      const updated = await service.update(owner, String(REVIEW), {
        rating: 2,
        text: 'Changed my mind',
      });
      expect(reviews.findByIdAndUpdate.mock.calls[0][1]).toEqual({
        $set: { rating: 2, text: 'Changed my mind' },
      });
      expect(updated).toMatchObject({ rating: 2, text: 'Changed my mind' });
      expect(hotels.updateOne).toHaveBeenCalledWith(
        { _id: HOTEL },
        { $set: { ratingAverage: 2, ratingCount: 1 } },
      );
    });

    it('editing only the text leaves the average alone', async () => {
      const { service, hotels } = setup();
      await service.update(owner, String(REVIEW), { text: 'Typo fixed' });
      expect(hotels.updateOne).not.toHaveBeenCalled();
    });

    it('deletes my review and recalculates (0 when it was the last one)', async () => {
      const { service, reviews, hotels } = setup({ stats: [] });
      await expect(service.remove(owner, String(REVIEW))).resolves.toEqual({
        message: 'Review deleted',
      });
      expect(reviews.deleteOne).toHaveBeenCalledWith({ _id: REVIEW });
      expect(hotels.updateOne).toHaveBeenCalledWith(
        { _id: HOTEL },
        { $set: { ratingAverage: 0, ratingCount: 0 } },
      );
    });

    it("another user's review is 404 for edit and delete, and nothing changes", async () => {
      const { service, reviews } = setup();
      await expect(
        service.update(stranger, String(REVIEW), { rating: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.remove(stranger, String(REVIEW)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(reviews.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(reviews.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe("a hotel's reviews (HTL-24)", () => {
    it('shows the average, the count and visible reviews newest first, 10 per page', async () => {
      const alive = new Types.ObjectId();
      const gone = new Types.ObjectId();
      const { service, reviews, findChain } = setup({
        rows: [
          { _id: 'r2', rating: 5, text: 'Great', userId: alive },
          { _id: 'r1', rating: 4, text: 'Good', userId: gone },
        ],
        users: [
          { _id: alive, name: 'Sara Ali', status: 'active' },
          { _id: gone, name: 'Omar', status: 'deactivated' },
        ],
      });
      const result = await service.listForHotel(String(HOTEL), {
        page: 2,
        limit: 10,
      });
      expect(reviews.find.mock.calls[0][0]).toEqual({
        hotelId: HOTEL,
        hidden: { $ne: true },
      });
      expect(findChain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(findChain.skip).toHaveBeenCalledWith(10);
      expect(findChain.limit).toHaveBeenCalledWith(10);
      expect(result.ratingAverage).toBe(4.5);
      expect(result.ratingCount).toBe(2);
      expect(result.data.map((r) => r.author)).toEqual([
        { id: alive, name: 'Sara Ali' },
        // ACC-12
        { id: null, name: 'Deleted user' },
      ]);
      expect(result.meta).toMatchObject({ page: 2, limit: 10, total: 2 });
    });

    it('a hotel with no reviews shows 0 and an empty list', async () => {
      const { service } = setup({
        hotel: { _id: HOTEL, isActive: true },
      });
      await expect(
        service.listForHotel(String(HOTEL), { page: 1, limit: 10 }),
      ).resolves.toMatchObject({ ratingAverage: 0, ratingCount: 0, data: [] });
    });

    it('an unknown or inactive hotel is 404, like its page', async () => {
      for (const hotel of [null, { _id: HOTEL, isActive: false }]) {
        await expect(
          setup({ hotel }).service.listForHotel(String(HOTEL), {
            page: 1,
            limit: 10,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('review input', () => {
    const errors = async (cls: any, body: object) =>
      (
        await validate(plainToInstance(cls, body), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).map((e) => e.property);

    it('rating is a whole number from 1 to 5; text is optional, at most 1000 characters', async () => {
      expect(await errors(CreateReviewDto, { rating: 5 })).toEqual([]);
      expect(await errors(CreateReviewDto, { rating: 1, text: 'ok' })).toEqual(
        [],
      );
      for (const rating of [0, 6, 4.5, '5', undefined]) {
        expect(await errors(CreateReviewDto, { rating })).toEqual(['rating']);
      }
      expect(
        await errors(CreateReviewDto, { rating: 5, text: 'x'.repeat(1001) }),
      ).toEqual(['text']);
      expect(
        await errors(CreateReviewDto, { rating: 5, hidden: true }),
      ).toEqual(['hidden']);
    });

    it('text is trimmed; an edit may change just one field', async () => {
      expect(
        plainToInstance(CreateReviewDto, { rating: 5, text: '  hi  ' }).text,
      ).toBe('hi');
      expect(await errors(UpdateReviewDto, { text: 'only text' })).toEqual([]);
      expect(await errors(UpdateReviewDto, { rating: 9 })).toEqual(['rating']);
    });
  });

  describe('HotelStayCompletionJob (HTL-23)', () => {
    it('marks Confirmed stays whose check-out date has passed as Completed', async () => {
      const bookings = {
        updateMany: jest.fn(async () => ({ modifiedCount: 3 })),
      };
      const job = new HotelStayCompletionJob(bookings as any);
      const now = new Date('2026-12-05T09:30:00.000Z');
      expect(await job.completeStays(now)).toBe(3);
      expect(bookings.updateMany).toHaveBeenCalledWith(
        // On the check-out day (2026-12-05) the stay stays Confirmed.
        { status: BookingStatus.CONFIRMED, checkOut: { $lt: '2026-12-05' } },
        { $set: { status: BookingStatus.COMPLETED, completedAt: now } },
      );
    });

    it('a database error is logged, not thrown', async () => {
      const job = new HotelStayCompletionJob({
        updateMany: async () => Promise.reject(new Error('db down')),
      } as any);
      await expect(job.completeStays()).resolves.toBe(0);
    });
  });
});
