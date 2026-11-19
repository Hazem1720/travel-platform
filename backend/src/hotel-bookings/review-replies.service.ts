import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { REVIEW_NOT_FOUND } from './reviews.service';
import { Review, ReviewDocument } from './schemas/review.schema';

export const ALREADY_REPLIED = 'This review already has a reply';

// HTL-26 (bonus): the hotel's own moderator replies once to a review of
// their hotel. Another hotel's moderator is 403; a second reply 409 (one
// conditional update, so two replies at once cannot both win). The
// reviewer is notified (GEN-01). The reply shows on GET /hotels/:id/reviews.
@Injectable()
export class ReviewRepliesService {
  private readonly logger = new Logger(ReviewRepliesService.name);

  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    private readonly notifications: NotificationsService,
  ) {}

  async reply(user: AuthUser, reviewId: string, text: string) {
    const review = isValidObjectId(reviewId)
      ? await this.reviews.findById(reviewId).lean()
      : null;
    if (!review) throw new NotFoundException(REVIEW_NOT_FOUND);
    assertOwnsProvider(user, Role.HOTEL_MODERATOR, String(review.hotelId));

    const reply = {
      text,
      moderatorId: new Types.ObjectId(user.id),
      createdAt: new Date(),
    };
    const updated = await this.reviews
      .findOneAndUpdate(
        { _id: review._id, reply: null },
        { $set: { reply } },
        { new: true },
      )
      .lean();
    if (!updated) throw new ConflictException(ALREADY_REPLIED);

    await this.notifications
      .create(
        review.userId,
        NotificationType.REVIEW_REPLIED,
        `The hotel replied to your review: "${text.slice(0, 120)}${text.length > 120 ? '...' : ''}"`,
        { reviewId: String(review._id), hotelId: String(review.hotelId) },
      )
      .catch((err: Error) =>
        this.logger.error(`HTL-26 notification: ${err.message}`),
      );

    return {
      _id: updated._id,
      hotelId: updated.hotelId,
      rating: updated.rating,
      text: updated.text,
      reply: { text: reply.text, createdAt: reply.createdAt },
    };
  }
}
