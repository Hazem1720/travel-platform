import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { ReviewRepliesService } from './review-replies.service';

const hotelId = new Types.ObjectId();
const reviewId = new Types.ObjectId();
const reviewer = new Types.ObjectId();
const mod = {
  id: new Types.ObjectId().toHexString(),
  role: Role.HOTEL_MODERATOR,
  assignedProviderId: String(hotelId),
};
const lean = (v: unknown) => ({ lean: async () => v });

function setup(existingReply: unknown = null) {
  const doc: any = {
    _id: reviewId,
    hotelId,
    userId: reviewer,
    rating: 4,
    text: 'Great',
    reply: existingReply,
  };
  const reviews = {
    findById: jest.fn<any, any[]>(() => lean(doc)),
    findOneAndUpdate: jest.fn<any, any[]>((f: any, u: any) =>
      lean(
        doc.reply === null && f.reply === null
          ? Object.assign(doc, u.$set)
          : null,
      ),
    ),
  };
  const notifications = { create: jest.fn<any, any[]>(async () => ({})) };
  return {
    service: new ReviewRepliesService(reviews as any, notifications as any),
    notifications,
    doc,
  };
}

describe('HTL-26: hotel moderator replies to a review', () => {
  it("the hotel's own moderator replies once; the reviewer is notified", async () => {
    const { service, notifications, doc } = setup();
    const res = await service.reply(mod, String(reviewId), 'Thank you!');
    expect(res.reply.text).toBe('Thank you!');
    expect(String(doc.reply.moderatorId)).toBe(mod.id);
    expect(notifications.create).toHaveBeenCalledWith(
      reviewer,
      'REVIEW_REPLIED',
      expect.stringContaining('Thank you!'),
      expect.any(Object),
    );
  });

  it('a second reply is 409', async () => {
    const { service } = setup({ text: 'old', createdAt: new Date() });
    await expect(
      service.reply(mod, String(reviewId), 'again'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("another hotel's moderator is 403", async () => {
    const other = { ...mod, assignedProviderId: String(new Types.ObjectId()) };
    await expect(
      setup().service.reply(other, String(reviewId), 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an unknown review is 404', async () => {
    const { service } = setup();
    await expect(service.reply(mod, 'bad', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
