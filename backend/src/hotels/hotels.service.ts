import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { City, CityDocument } from '../reference/schemas/reference.schemas';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelPoliciesDto } from './dto/policies.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel, HotelDocument } from './schemas/hotel.schema';

export const HOTEL_NOT_FOUND = 'Hotel not found';

// HTL-01 (profile), HTL-09 and HTL-10 (policies), HTL-02 (details page).
// Exported for other modules: Hazem (ACC-13 checks that a moderator's hotel
// exists, ACC-15 deactivates a hotel) and Memo (search, bookings).
@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
  ) {}

  // The city must exist and the country code must be that city's country
  // (cairo with DE is a 400, so is an unknown city).
  private async assertCityInCountry(cityId: string, countryCode: string) {
    const city = await this.cities.findById(cityId).lean();
    if (!city) throw new BadRequestException(`Unknown city "${cityId}"`);
    if (city.countryCode !== countryCode) {
      throw new BadRequestException(
        `City "${cityId}" is in ${city.countryCode}, not ${countryCode}`,
      );
    }
  }

  async create(dto: CreateHotelDto) {
    await this.assertCityInCountry(dto.cityId, dto.countryCode);
    const hotel = await this.hotels.create(dto);
    return hotel.toObject();
  }

  // HTL-02: the public details page. An inactive hotel is hidden from the
  // public (404), the same answer as for a hotel that does not exist.
  async getPublic(id: string) {
    const hotel = await this.hotels.findById(id).lean();
    if (!hotel || !hotel.isActive) throw new NotFoundException(HOTEL_NOT_FOUND);
    return hotel;
  }

  // Only the fields of UpdateHotelDto can reach here (whitelisted DTO), so a
  // client can never set isActive, images, ratings or the policies this way.
  async update(id: string, dto: UpdateHotelDto) {
    const current = await this.hotels.findById(id).lean();
    if (!current) throw new NotFoundException(HOTEL_NOT_FOUND);
    // Changing only the city or only the country must still match the other.
    if (dto.cityId !== undefined || dto.countryCode !== undefined) {
      await this.assertCityInCountry(
        dto.cityId ?? current.cityId,
        dto.countryCode ?? current.countryCode,
      );
    }
    const updated = await this.hotels
      .findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true })
      .lean();
    if (!updated) throw new NotFoundException(HOTEL_NOT_FOUND);
    return updated;
  }

  // HTL-09 and HTL-10: replaces the standard times and the cancellation tiers.
  async setPolicies(id: string, dto: HotelPoliciesDto) {
    const hotel = await this.hotels
      .findByIdAndUpdate(
        id,
        {
          $set: {
            checkInTime: dto.checkInTime,
            checkOutTime: dto.checkOutTime,
            cancellationTiers: dto.cancellationTiers,
          },
        },
        { new: true, runValidators: true },
      )
      .lean();
    if (!hotel) throw new NotFoundException(HOTEL_NOT_FOUND);
    return hotel;
  }
}
