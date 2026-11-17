import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { summarizeByCurrency } from './budget.summary';
import { DaysService } from './days.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';
import { ItinerariesService } from './itineraries.service';
import {
  BudgetEntry,
  Itinerary,
  ItineraryDocument,
} from './schemas/itinerary.schema';

export const BUDGET_NOT_FOUND = 'Budget entry not found';
export const BUDGET_DELETED = 'Budget entry deleted';

// ITN-14: budget entries embedded in their day, and the budget summary.
@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    private readonly itinerariesService: ItinerariesService,
    private readonly days: DaysService,
  ) {}

  async add(user: AuthUser, id: string, dayId: string, dto: CreateBudgetDto) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    this.days.assertHasDay(itinerary, dayId);
    const entry = {
      _id: new Types.ObjectId(),
      category: dto.category,
      amount: dto.amount,
      currency: dto.currency,
      note: dto.note ?? '',
    };
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id, 'days._id': dayId },
        { $push: { 'days.$.budgets': entry } },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Day not found');
    return { ...entry, itineraryId: id, dayId };
  }

  async update(user: AuthUser, entryId: string, dto: UpdateBudgetDto) {
    const { itinerary } = await this.findOwnedEntry(user, entryId);
    const path = 'days.$[d].budgets.$[b]';
    const set: Record<string, unknown> = {};
    for (const key of ['category', 'amount', 'currency', 'note'] as const) {
      if (dto[key] !== undefined) set[`${path}.${key}`] = dto[key];
    }
    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: itinerary._id, ownerId: user.id },
        { $set: set },
        {
          new: true,
          runValidators: true,
          arrayFilters: [
            { 'd.budgets._id': new Types.ObjectId(entryId) },
            { 'b._id': new Types.ObjectId(entryId) },
          ],
        },
      )
      .lean();
    const found = updated && locateBudget(updated, entryId);
    if (!found) throw new NotFoundException(BUDGET_NOT_FOUND);
    return {
      ...found.entry,
      itineraryId: itinerary._id,
      dayId: found.day._id,
    };
  }

  async remove(user: AuthUser, entryId: string) {
    const { itinerary } = await this.findOwnedEntry(user, entryId);
    await this.itineraries.updateOne(
      { _id: itinerary._id, ownerId: user.id },
      { $pull: { 'days.$[].budgets': { _id: new Types.ObjectId(entryId) } } },
    );
    return { message: BUDGET_DELETED };
  }

  // ITN-14: totals by category and by day, including activity costs (under
  // Activities) and intercity transport (its own line).
  async summary(user: AuthUser, id: string) {
    const itinerary = await this.itinerariesService.findOwned(user, id);
    return summarizeByCurrency(itinerary);
  }

  private async findOwnedEntry(user: AuthUser, entryId: string) {
    const itinerary = await this.itineraries
      .findOne({ 'days.budgets._id': entryId })
      .lean();
    if (!itinerary) throw new NotFoundException(BUDGET_NOT_FOUND);
    assertOwner(itinerary.ownerId, user, BUDGET_NOT_FOUND);
    const found = locateBudget(itinerary, entryId);
    if (!found) throw new NotFoundException(BUDGET_NOT_FOUND);
    return { itinerary, ...found };
  }
}

function locateBudget<D extends { _id: unknown; budgets: BudgetEntry[] }>(
  itinerary: { days: D[] },
  entryId: string,
) {
  for (const day of itinerary.days) {
    const entry = day.budgets?.find((b) => String(b._id) === entryId);
    if (entry) return { day, entry };
  }
  return null;
}
