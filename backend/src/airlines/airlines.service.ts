import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
}
