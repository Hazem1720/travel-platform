import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { DaysService } from './days.service';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { ItinerariesService } from './itineraries.service';
import {
  Activity,
  Itinerary,
  ItineraryDocument,
} from './schemas/itinerary.schema';

export const ACTIVITY_NOT_FOUND = 'Activity not found';
export const ACTIVITY_DELETED = 'Activity deleted';

// ITN-10: activities are embedded in their day, so every change is one
// update on the itinerary document. Routes by activity id still check that
// the itinerary belongs to the user (404 otherwise).
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    private readonly itinerariesService: ItinerariesService,
    private readonly days: DaysService,
  ) {}

  async add(user: AuthUser, id: string, dayId: string, dto: CreateActivityDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    this.days.assertHasDay(itinerary, dayId);
    const activity = {
      _id: new Types.ObjectId(),
      name: dto.name,
      description: dto.description ?? '',
      time: dto.time ?? null,
      cost: dto.cost ?? null,
      images: [],
    };
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id, 'days._id': dayId },
        { $push: { 'days.$.activities': activity } },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Day not found');
    return this.view(updated, String(activity._id));
  }

  async update(user: AuthUser, activityId: string, dto: UpdateActivityDto) {
    const { itinerary } = await this.findOwnedActivity(user, activityId);
    const set: Record<string, unknown> = {};
    const path = 'days.$[d].activities.$[a]';
    if (dto.name !== undefined) set[`${path}.name`] = dto.name;
    if (dto.description !== undefined) {
      set[`${path}.description`] = dto.description;
    }
    if (dto.time !== undefined) set[`${path}.time`] = dto.time;
    if (dto.cost !== undefined) set[`${path}.cost`] = dto.cost;

    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: itinerary._id, ownerId: user.id },
        { $set: set },
        {
          new: true,
          runValidators: true,
          arrayFilters: [
            { 'd.activities._id': new Types.ObjectId(activityId) },
            { 'a._id': new Types.ObjectId(activityId) },
          ],
        },
      )
      .lean();
    if (!updated) throw new NotFoundException(ACTIVITY_NOT_FOUND);
    return this.view(updated, activityId);
  }

  async remove(user: AuthUser, activityId: string) {
    const { itinerary } = await this.findOwnedActivity(user, activityId);
    await this.itineraries.updateOne(
      { _id: itinerary._id, ownerId: user.id },
      {
        $pull: {
          'days.$[].activities': { _id: new Types.ObjectId(activityId) },
        },
      },
    );
    return { message: ACTIVITY_DELETED };
  }

  // Finds the itinerary that holds the activity; 404 if there is none or
  // it belongs to another user (ACC-11).
  async findOwnedActivity(user: AuthUser, activityId: string) {
    const itinerary = await this.itineraries
      .findOne({ 'days.activities._id': activityId })
      .lean();
    if (!itinerary) throw new NotFoundException(ACTIVITY_NOT_FOUND);
    assertOwner(itinerary.ownerId, user, ACTIVITY_NOT_FOUND);
    const found = locateActivity(itinerary, activityId);
    if (!found) throw new NotFoundException(ACTIVITY_NOT_FOUND);
    return { itinerary, ...found };
  }

  private view(
    itinerary: {
      _id: unknown;
      days: { _id: unknown; activities: Activity[] }[];
    },
    activityId: string,
  ) {
    const found = locateActivity(itinerary, activityId);
    if (!found) throw new NotFoundException(ACTIVITY_NOT_FOUND);
    return {
      ...found.activity,
      itineraryId: itinerary._id,
      dayId: found.day._id,
    };
  }
}

export function locateActivity<
  D extends { _id: unknown; activities: Activity[] },
>(itinerary: { days: D[] }, activityId: string) {
  for (const day of itinerary.days) {
    const activity = day.activities?.find((a) => String(a._id) === activityId);
    if (activity) return { day, activity };
  }
  return null;
}
