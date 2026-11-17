import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { DaysService } from './days.service';
import {
  CreateTransportCostDto,
  UpdateTransportCostDto,
} from './dto/transport-cost.dto';
import { ItinerariesService } from './itineraries.service';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';

export const TRANSPORT_NOT_FOUND = 'Transport cost not found';
export const TRANSPORT_DELETED = 'Transport cost deleted';

// ITN-16: intercity transport costs, embedded in the itinerary. Each belongs
// to one of its days and counts as its own line in the budget (ITN-14).
@Injectable()
export class TransportCostsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    private readonly itinerariesService: ItinerariesService,
    private readonly days: DaysService,
  ) {}

  async add(user: AuthUser, id: string, dto: CreateTransportCostDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    this.assertDayOf(itinerary, dto.dayId);
    await this.days.assertCity(dto.fromCityId, 'fromCityId');
    await this.days.assertCity(dto.toCityId, 'toCityId');
    const entry = {
      _id: new Types.ObjectId(),
      mode: dto.mode,
      fromCityId: dto.fromCityId,
      toCityId: dto.toCityId,
      amount: dto.amount,
      currency: dto.currency,
      dayId: new Types.ObjectId(dto.dayId),
    };
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id, 'days._id': entry.dayId },
        { $push: { transportCosts: entry } },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) this.dayError();
    return { ...entry, itineraryId: id };
  }

  async update(user: AuthUser, entryId: string, dto: UpdateTransportCostDto) {
    const itinerary = await this.findOwnedItinerary(user, entryId);
    if (dto.dayId !== undefined) this.assertDayOf(itinerary, dto.dayId);
    if (dto.fromCityId !== undefined) {
      await this.days.assertCity(dto.fromCityId, 'fromCityId');
    }
    if (dto.toCityId !== undefined) {
      await this.days.assertCity(dto.toCityId, 'toCityId');
    }
    const set: Record<string, unknown> = {};
    for (const key of [
      'mode',
      'fromCityId',
      'toCityId',
      'amount',
      'currency',
    ] as const) {
      if (dto[key] !== undefined) set[`transportCosts.$.${key}`] = dto[key];
    }
    if (dto.dayId !== undefined) {
      set['transportCosts.$.dayId'] = new Types.ObjectId(dto.dayId);
    }
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: itinerary._id, ownerId: user.id, 'transportCosts._id': entryId },
        { $set: set },
        { new: true, runValidators: true },
      )
      .lean();
    const entry = updated?.transportCosts.find(
      (t) => String(t._id) === entryId,
    );
    if (!entry) throw new NotFoundException(TRANSPORT_NOT_FOUND);
    return { ...entry, itineraryId: itinerary._id };
  }

  async remove(user: AuthUser, entryId: string) {
    const itinerary = await this.findOwnedItinerary(user, entryId);
    await this.itineraries.updateOne(
      { _id: itinerary._id, ownerId: user.id },
      { $pull: { transportCosts: { _id: new Types.ObjectId(entryId) } } },
    );
    return { message: TRANSPORT_DELETED };
  }

  private async findOwnedItinerary(user: AuthUser, entryId: string) {
    const itinerary = await this.itineraries
      .findOne({ 'transportCosts._id': entryId })
      .lean();
    if (!itinerary) throw new NotFoundException(TRANSPORT_NOT_FOUND);
    assertOwner(itinerary.ownerId, user, TRANSPORT_NOT_FOUND);
    return itinerary;
  }

  // The day must belong to this itinerary: a day of another one gives 400.
  private assertDayOf(itinerary: { days: { _id: unknown }[] }, dayId: string) {
    if (!itinerary.days.some((d) => String(d._id) === dayId)) this.dayError();
  }

  private dayError(): never {
    throw new BadRequestException({
      error: 'Bad Request',
      message: 'Validation failed',
      details: { dayId: ['dayId must be a day of this itinerary'] },
    });
  }
}
