import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthUser } from '../common/types/auth-user.type';
import { City, CityDocument } from '../reference/schemas/reference.schemas';
import { CreateDayDto, ReorderDayDto, UpdateDayDto } from './dto/day.dto';
import { ItinerariesService } from './itineraries.service';
import { presentItinerary } from './itinerary.view';
import {
  Itinerary,
  ItineraryDocument,
  MAX_ITINERARY_DAYS,
} from './schemas/itinerary.schema';

export const DAY_NOT_FOUND = 'Day not found';
export const TOO_MANY_DAYS = `An itinerary has at most ${MAX_ITINERARY_DAYS} days`;

// ITN-05 (add and edit days). Days are embedded in the itinerary; their
// number and date come from their position (itinerary.view.ts).
@Injectable()
export class DaysService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
    private readonly itinerariesService: ItinerariesService,
  ) {}

  // ITN-05: adds a day at the end. The 60-day limit is part of the update's
  // filter ("no 60th day yet"), so two requests at once cannot pass it.
  async addDay(user: AuthUser, id: string, dto: CreateDayDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    await this.assertCity(dto.cityId);
    if (itinerary.days.length >= MAX_ITINERARY_DAYS) {
      throw new BadRequestException(TOO_MANY_DAYS);
    }
    const updated = await this.itineraries
      .findOneAndUpdate(
        {
          _id: id,
          ownerId: user.id,
          [`days.${MAX_ITINERARY_DAYS - 1}`]: { $exists: false },
        },
        {
          $push: {
            days: {
              _id: new Types.ObjectId(),
              cityId: dto.cityId,
              notes: dto.notes ?? '',
            },
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) throw new BadRequestException(TOO_MANY_DAYS);
    return presentItinerary(updated);
  }

  // ITN-05: changes one day's city or notes.
  async updateDay(
    user: AuthUser,
    id: string,
    dayId: string,
    dto: UpdateDayDto,
  ) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    this.assertHasDay(itinerary, dayId);
    if (dto.cityId !== undefined) await this.assertCity(dto.cityId);

    const set: Record<string, string> = {};
    if (dto.cityId !== undefined) set['days.$.cityId'] = dto.cityId;
    if (dto.notes !== undefined) set['days.$.notes'] = dto.notes;

    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id, 'days._id': dayId },
        { $set: set },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException(DAY_NOT_FOUND);
    return presentItinerary(updated);
  }

  // ITN-07: deletes a day (the frontend confirms first). Its activities and
  // budget entries go with it. Numbers, dates and budget totals are always
  // computed from the remaining days, so they are recalculated at once.
  async removeDay(user: AuthUser, id: string, dayId: string) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    this.assertHasDay(itinerary, dayId);
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id, 'days._id': dayId },
        { $pull: { days: { _id: new Types.ObjectId(dayId) } } },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException(DAY_NOT_FOUND);
    return presentItinerary(updated);
  }

  // ITN-08: moves a day to a new position (1 = first). Numbers, dates and
  // city groups are computed from the order, so they follow. The update only
  // applies if the itinerary has not changed since it was read, so a day
  // added or deleted at the same moment is never lost (409, try again).
  async reorderDay(user: AuthUser, id: string, dto: ReorderDayDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    const from = this.assertHasDay(itinerary, dto.dayId);
    if (dto.newPosition > itinerary.days.length) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: {
          newPosition: [
            `newPosition must be between 1 and ${itinerary.days.length}`,
          ],
        },
      });
    }
    const days = [...itinerary.days];
    const [moved] = days.splice(from, 1);
    days.splice(dto.newPosition - 1, 0, moved);

    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id, updatedAt: itinerary.updatedAt },
        { $set: { days } },
        { new: true },
      )
      .lean();
    if (!updated) {
      throw new ConflictException(
        'The itinerary changed at the same time, please try again',
      );
    }
    return presentItinerary(updated);
  }

  assertHasDay(itinerary: { days: { _id: unknown }[] }, dayId: string) {
    const index = itinerary.days.findIndex((d) => String(d._id) === dayId);
    if (index < 0) throw new NotFoundException(DAY_NOT_FOUND);
    return index;
  }

  // GEN-12: the city must be in the seeded city list (shared with hotels
  // and airports).
  async assertCity(cityId: string) {
    if (!(await this.cities.exists({ _id: cityId }))) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { cityId: [`Unknown city: ${cityId}`] },
      });
    }
  }
}
