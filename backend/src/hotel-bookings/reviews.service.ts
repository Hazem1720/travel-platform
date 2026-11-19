import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { AccountStatus } from '../common/enums/role.enum';
import { assertOwner } from '../common/helpers/ownership';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { DELETED_USER } from '../comments/comments.service';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import { RESERVATION_NOT_FOUND } from './hotel-confirmation.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Review, ReviewDocument } from './schemas/review.schema';

export const REVIEW_NOT_FOUND = 'Review not found';
export const REVIEW_NOT_COMPLETED =
  'You can rate a stay only after its check-out date has passed';
export const REVIEW_ALREADY_EXISTS =
  'You have already reviewed this reservation; edit or delete that review';
export const REVIEW_DELETED = 'Review deleted';

// HTL-23 and HTL-24 (Hasan): one rating (1-5) and an optional review per
// Completed reservation, edited or deleted by its author; the hotel's
// ratingAverage and ratingCount follow every change; anyone can read a
// hotel's visible reviews, newest first.
@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name)
    private readonly reviews: Model<ReviewDocument>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // HTL-23: POST /hotel-bookings/:id/review. Only the owner (others 404),
  // only once the reservation is Completed (409), only once (409).
  async create(user: AuthUser, bookingId: string, dto: CreateReviewDto) {
    const booking = isValidObjectId(bookingId)
      ? await this.bookings
          .findById(bookingId, { userId: 1, hotelId: 1, status: 1 })
          .lean()
      : null;
    assertOwner(booking?.userId, user, RESERVATION_NOT_FOUND);
    if (booking!.status !== BookingStatus.COMPLETED) {
      throw new ConflictException(REVIEW_NOT_COMPLETED);
    }
    let review: ReviewDocument;
    try {
      review = await this.reviews.create({
        hotelId: booking!.hotelId,
        bookingId: booking!._id,
        userId: new Types.ObjectId(user.id),
        rating: dto.rating,
        text: dto.text ?? '',
      });
    } catch (err) {
      // The unique index on bookingId: one review per reservation.
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(REVIEW_ALREADY_EXISTS);
      }
      throw err;
    }
    await this.recalculateHotelRating(booking!.hotelId);
    return review.toObject();
  }

  // HTL-23: PATCH /reviews/:id, by its author only (others 404).
  async update(user: AuthUser, reviewId: string, dto: UpdateReviewDto) {
    const review = await this.findOwn(user, reviewId);
    const changes: Partial<Pick<Review, 'rating' | 'text'>> = {};
    if (dto.rating !== undefined) changes.rating = dto.rating;
    if (dto.text !== undefined) changes.text = dto.text;
    const updated = await this.reviews
      .findByIdAndUpdate(
        review._id,
        { $set: changes },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean();
    if (!updated) throw new NotFoundException(REVIEW_NOT_FOUND);
    if (changes.rating !== undefined && changes.rating !== review.rating) {
      await this.recalculateHotelRating(review.hotelId);
    }
    return updated;
  }

  // HTL-23: DELETE /reviews/:id, by its author only (others 404).
  async remove(user: AuthUser, reviewId: string) {
    const review = await this.findOwn(user, reviewId);
    await this.reviews.deleteOne({ _id: review._id });
    await this.recalculateHotelRating(review.hotelId);
    return { message: REVIEW_DELETED };
  }

  // HTL-24: GET /hotels/:id/reviews. The hotel's average and number of
  // ratings, and its visible reviews newest first, 10 per page. Hidden
  // reviews (GEN-10) are left out of the list but still count in the
  // average (review.schema.ts). A deactivated author shows as "Deleted
  // user" (ACC-12). An unknown or inactive hotel is 404, like its page.
  async listForHotel(hotelId: string, { page, limit }: PaginationQueryDto) {
    const hotel = isValidObjectId(hotelId)
      ? await this.hotels
          .findById(hotelId, { isActive: 1, ratingAverage: 1, ratingCount: 1 })
          .lean()
      : null;
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException(HOTEL_NOT_FOUND);
    }
    const filter = { hotelId: hotel._id, hidden: { $ne: true } };
    const [rows, total] = await Promise.all([
      this.reviews
        .find(filter, {
          rating: 1,
          text: 1,
          userId: 1,
          createdAt: 1,
          updatedAt: 1,
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.reviews.countDocuments(filter),
    ]);

    const authors = await this.connection
      .collection('users')
      .find(
        { _id: { $in: rows.map((r) => r.userId) } },
        { projection: { name: 1, status: 1 } },
      )
      .toArray();
    const byId = new Map(authors.map((a) => [String(a._id), a]));

    const data = rows.map((r) => {
      const author = byId.get(String(r.userId));
      const gone = !author || author.status === AccountStatus.DEACTIVATED;
      return {
        _id: r._id,
        rating: r.rating,
        text: r.text,
        author: gone
          ? { id: null, name: DELETED_USER }
          : { id: r.userId, name: String(author.name ?? '') },
        createdAt: (r as { createdAt?: Date }).createdAt,
        updatedAt: (r as { updatedAt?: Date }).updatedAt,
      };
    });
    return {
      ratingAverage: hotel.ratingAverage ?? 0,
      ratingCount: hotel.ratingCount ?? 0,
      ...paginated(data, total, page, limit),
    };
  }

  // Average of all the hotel's reviews (hidden ones still count), rounded
  // to one decimal; 0 with no reviews. The same rule as Emad's moderation
  // (ReportsService), so both always agree.
  async recalculateHotelRating(hotelId: Types.ObjectId): Promise<void> {
    const [stats] = await this.reviews.aggregate<{
      average: number;
      count: number;
    }>([
      { $match: { hotelId: new Types.ObjectId(String(hotelId)) } },
      {
        $group: {
          _id: null,
          average: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);
    await this.hotels.updateOne(
      { _id: hotelId },
      {
        $set: {
          ratingAverage: stats ? Math.round(stats.average * 10) / 10 : 0,
          ratingCount: stats?.count ?? 0,
        },
      },
    );
  }

  private async findOwn(user: AuthUser, reviewId: string) {
    const review = isValidObjectId(reviewId)
      ? await this.reviews.findById(reviewId).lean()
      : null;
    assertOwner(review?.userId, user, REVIEW_NOT_FOUND);
    return review!;
  }
}
