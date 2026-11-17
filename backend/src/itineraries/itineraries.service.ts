import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import {
  Country,
  CountryDocument,
} from '../reference/schemas/reference.schemas';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import { Itinerary, ItineraryDocument } from './schemas/itinerary.schema';

export const ITINERARY_NOT_FOUND = 'Itinerary not found';
export const ITINERARY_DELETED = 'Itinerary deleted';

// "2026-12-01" (already checked by IsDateOnly) to UTC midnight of that day.
export function toUtcDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

// ITN-01 (create, edit, delete). Exported for Hafez (GEN-09, GEN-10) and for
// the rest of the ITN requirements.
@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    @InjectModel(Country.name)
    private readonly countries: Model<CountryDocument>,
  ) {}

  // ITN-01: always Private and without days at first.
  async create(user: AuthUser, dto: CreateItineraryDto) {
    const countries = await this.assertCountries(dto.countries);
    const itinerary = await this.itineraries.create({
      ownerId: user.id,
      title: dto.title,
      countries,
      startDate: toUtcDate(dto.startDate),
    });
    return itinerary.toObject();
  }

  // ITN-01: the owner edits the title, countries and start date. Day dates
  // are computed from startDate, so they follow it automatically (ITN-05).
  async update(user: AuthUser, id: string, dto: UpdateItineraryDto) {
    await this.findOwned(user, id);
    const set: Partial<Pick<Itinerary, 'title' | 'countries' | 'startDate'>> =
      {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.countries !== undefined) {
      set.countries = await this.assertCountries(dto.countries);
    }
    if (dto.startDate !== undefined) set.startDate = toUtcDate(dto.startDate);

    const updated = await this.itineraries
      .findOneAndUpdate(
        { _id: id, ownerId: user.id },
        { $set: set },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) throw new NotFoundException(ITINERARY_NOT_FOUND);
    return updated;
  }

  // ITN-01: deleting removes the document, so it leaves public search at
  // once. Clones are separate documents and are never touched.
  async remove(user: AuthUser, id: string) {
    await this.findOwned(user, id);
    const result = await this.itineraries.deleteOne({
      _id: id,
      ownerId: user.id,
    });
    if (result.deletedCount === 0) {
      throw new NotFoundException(ITINERARY_NOT_FOUND);
    }
    return { message: ITINERARY_DELETED };
  }

  // ACC-11: another user's itinerary answers 404, as if it did not exist.
  async findOwned(user: AuthUser, id: string) {
    const itinerary = await this.itineraries.findById(id).lean();
    if (!itinerary) throw new NotFoundException(ITINERARY_NOT_FOUND);
    assertOwner(itinerary.ownerId, user, ITINERARY_NOT_FOUND);
    return itinerary;
  }

  // GEN-12: every country must be in the seeded countries list. Returns the
  // codes without duplicates, in the order given.
  private async assertCountries(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const found = await this.countries
      .find({ _id: { $in: unique } }, { _id: 1 })
      .lean();
    const known = new Set(found.map((c) => String(c._id)));
    const unknown = unique.filter((c) => !known.has(c));
    if (unknown.length > 0) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { countries: [`Unknown country: ${unknown.join(', ')}`] },
      });
    }
    return unique;
  }
}
