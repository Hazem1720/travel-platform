import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/types/auth-user.type';
import {
  IMAGE_LIMITS,
  UploadedImage,
  assertImageLimit,
} from '../uploads/image-file';
import { UPLOADS_URL_PREFIX, UploadsService } from '../uploads/uploads.service';
import { ActivitiesService, locateActivity } from './activities.service';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';

export const MAX_ACTIVITY_IMAGES = IMAGE_LIMITS.ACTIVITY;
export const IMAGE_NOT_FOUND = 'Image not found';

// ITN-12: images on an activity, through the shared upload utility (GEN-08):
// JPG or PNG, at most 5 MB each, up to 5 per activity.
@Injectable()
export class ActivityImagesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    private readonly activities: ActivitiesService,
    private readonly uploads: UploadsService,
  ) {}

  // The files are saved first, then pushed only while the activity still has
  // room for all of them (the limit is in the update's filter), so two
  // uploads at once cannot pass 5 together. If the push fails, the saved
  // files are deleted again.
  async addImages(user: AuthUser, activityId: string, files: UploadedImage[]) {
    const { activity } = await this.activities.findOwnedActivity(
      user,
      activityId,
    );
    assertImageLimit(activity.images.length, files.length, MAX_ACTIVITY_IMAGES);

    const urls = await this.uploads.save(files);
    const aid = new Types.ObjectId(activityId);
    const updated = await this.itineraries
      .findOneAndUpdate(
        {
          ownerId: user.id,
          days: {
            $elemMatch: {
              activities: {
                $elemMatch: {
                  _id: aid,
                  [`images.${MAX_ACTIVITY_IMAGES - urls.length}`]: {
                    $exists: false,
                  },
                },
              },
            },
          },
        },
        { $push: { 'days.$[d].activities.$[a].images': { $each: urls } } },
        {
          new: true,
          arrayFilters: [{ 'd.activities._id': aid }, { 'a._id': aid }],
        },
      )
      .lean();
    const found = updated && locateActivity(updated, activityId);
    if (found) return { ...found.activity, dayId: found.day._id };

    await Promise.all(urls.map((url) => this.uploads.remove(url)));
    throw new BadRequestException(
      `At most ${MAX_ACTIVITY_IMAGES} images allowed, please try again`,
    );
  }

  // Removes one image by its file name (the last part of its URL).
  async removeImage(user: AuthUser, activityId: string, file: string) {
    const { activity } = await this.activities.findOwnedActivity(
      user,
      activityId,
    );
    const url = UPLOADS_URL_PREFIX + file;
    if (!activity.images.includes(url)) {
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }
    const aid = new Types.ObjectId(activityId);
    const updated = await this.itineraries
      .findOneAndUpdate(
        { ownerId: user.id, 'days.activities._id': aid },
        { $pull: { 'days.$[d].activities.$[a].images': url } },
        {
          new: true,
          arrayFilters: [{ 'd.activities._id': aid }, { 'a._id': aid }],
        },
      )
      .lean();
    const found = updated && locateActivity(updated, activityId);
    if (!found) throw new NotFoundException(IMAGE_NOT_FOUND);
    await this.releaseFiles([url]);
    return { ...found.activity, dayId: found.day._id };
  }

  // ITN-10 delete, with its image files (ITN-12).
  async removeActivity(user: AuthUser, activityId: string) {
    const { activity } = await this.activities.findOwnedActivity(
      user,
      activityId,
    );
    const result = await this.activities.remove(user, activityId);
    await this.releaseFiles(activity.images ?? []);
    return result;
  }

  // Deletes the files no itinerary uses any more. A clone (ITN-21) shares
  // its original's image URLs, so a file stays while any copy still has it.
  async releaseFiles(urls: string[]) {
    for (const url of urls) {
      const used = await this.itineraries.exists({
        'days.activities.images': url,
      });
      if (!used) await this.uploads.remove(url);
    }
  }
}
