import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CancellationPolicyDto } from '../common/helpers/cancellation-tiers';
import { UploadedImage } from '../uploads/image-file';
import { UploadsService } from '../uploads/uploads.service';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { Airline, AirlineDocument } from './schemas/airline.schema';

export const AIRLINE_NOT_FOUND = 'Airline not found';

// FLT-01. Exported for other modules: Hasan's ACC-13 (check that a
// moderator's airline exists) and Aabsy's search and bookings.
@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    private readonly uploads: UploadsService,
  ) {}

  // A duplicate code is rejected by the unique index (409 via the global
  // filter), which also covers two admins creating the same code at once.
  async create(dto: CreateAirlineDto) {
    const airline = await this.airlines.create(dto);
    return airline.toObject();
  }

  async get(id: string) {
    const airline = await this.airlines.findById(id).lean();
    if (!airline) throw new NotFoundException(AIRLINE_NOT_FOUND);
    return airline;
  }

  // Only the fields of UpdateAirlineDto can reach here (whitelisted DTO).
  async update(id: string, dto: UpdateAirlineDto) {
    const airline = await this.airlines
      .findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
      .lean();
    if (!airline) throw new NotFoundException(AIRLINE_NOT_FOUND);
    return airline;
  }

  private async set(id: string, fields: Partial<Airline>) {
    const airline = await this.airlines
      .findByIdAndUpdate(
        id,
        { $set: fields },
        { new: true, runValidators: true },
      )
      .lean();
    if (!airline) throw new NotFoundException(AIRLINE_NOT_FOUND);
    return airline;
  }

  // FLT-08: replaces the baggage policy.
  setBaggagePolicy(id: string, dto: BaggagePolicyDto) {
    return this.set(id, {
      extraBagPrice: dto.extraBagPrice,
      maxExtraBags: dto.maxExtraBags,
    });
  }

  // FLT-09: replaces the cancellation tiers (unique daysBefore, checked by
  // CancellationPolicyDto). An empty list means every cancellation refunds 0%.
  setCancellationPolicy(id: string, dto: CancellationPolicyDto) {
    return this.set(id, {
      cancellationTiers: dto.tiers.map((t) => ({
        daysBefore: t.daysBefore,
        refundPercent: t.refundPercent,
      })),
    });
  }

  // FLT-01: one logo per airline. The new file replaces the old one, which
  // is deleted from the server.
  async setLogo(id: string, files: UploadedImage[]) {
    const current = await this.get(id);
    const [url] = await this.uploads.save(files.slice(0, 1));
    try {
      const airline = await this.set(id, { logo: url });
      if (current.logo && current.logo !== url) {
        await this.uploads.remove(current.logo);
      }
      return airline;
    } catch (err) {
      await this.uploads.remove(url);
      throw err;
    }
  }
}
