import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  HotelAvailabilityService,
  stayNights,
} from '../hotel-bookings/hotel-availability.service';
import { HotelSearchService } from '../hotel-bookings/hotel-search.service';
import {
  Review,
  ReviewDocument,
} from '../hotel-bookings/schemas/review.schema';
import { City, CityDocument } from '../reference/schemas/reference.schemas';
import { assertImageLimit, UploadedImage } from '../uploads/image-file';
import { UPLOADS_URL_PREFIX, UploadsService } from '../uploads/uploads.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { HotelDetailsQueryDto } from './dto/hotel-details.dto';
import { HotelPoliciesDto } from './dto/policies.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel, HotelDocument, MAX_HOTEL_IMAGES } from './schemas/hotel.schema';

export const HOTEL_NOT_FOUND = 'Hotel not found';
export const IMAGE_NOT_FOUND = 'Image not found';
export const BOTH_DATES = 'Give both checkIn and checkOut, or neither';
// HTL-02: how many reviews the hotel page shows (newest first).
export const DETAILS_REVIEWS = 10;

export interface HotelDetailsRoom {
  id: string;
  name: string;
  type: string;
  beds: number;
  maxOccupancy: number;
  pricePerNight: number;
  nights: number;
  totalPrice: number;
}

export interface HotelDetailsReview {
  id: string;
  rating: number;
  text: string;
  createdAt?: Date;
}

export type HotelDetails = Hotel & {
  _id: unknown;
  reviews: HotelDetailsReview[];
  availableRooms: HotelDetailsRoom[];
  checkIn: string | null;
  checkOut: string | null;
};

function dateError(field: string, message: string) {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// HTL-01 (profile), HTL-09 and HTL-10 (policies), HTL-02 (details page).
// Exported for other modules: Hazem (ACC-13 checks that a moderator's hotel
// exists, ACC-15 deactivates a hotel) and Memo (search, bookings).
@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
    private readonly uploads: UploadsService,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    private readonly availability: HotelAvailabilityService,
    private readonly search: HotelSearchService,
  ) {}

  // HTL-01 photos (GEN-08): adds up to 5 in total. The files are saved first,
  // then pushed only while the hotel still has room for all of them, in one
  // conditional update, so two uploads at the same moment cannot pass 5
  // together. If the push fails, the saved files are deleted again.
  async addImages(id: string, files: UploadedImage[]) {
    const current = await this.hotels.findById(id, { images: 1 }).lean();
    if (!current) throw new NotFoundException(HOTEL_NOT_FOUND);
    assertImageLimit(current.images.length, files.length, MAX_HOTEL_IMAGES);

    const urls = await this.uploads.save(files);
    const updated = await this.hotels
      .findOneAndUpdate(
        {
          _id: id,
          $expr: {
            $lte: [
              { $size: { $ifNull: ['$images', []] } },
              MAX_HOTEL_IMAGES - urls.length,
            ],
          },
        },
        { $push: { images: { $each: urls } } },
        { new: true },
      )
      .lean();
    if (updated) return updated;

    await Promise.all(urls.map((url) => this.uploads.remove(url)));
    const now = await this.hotels.findById(id, { images: 1 }).lean();
    if (!now) throw new NotFoundException(HOTEL_NOT_FOUND);
    assertImageLimit(now.images.length, files.length, MAX_HOTEL_IMAGES);
    // Only reached if another request freed a slot in between: ask to retry.
    throw new BadRequestException(
      `At most ${MAX_HOTEL_IMAGES} images allowed, please try again`,
    );
  }

  // HTL-01 photos: removes one photo by its file name (the last part of its
  // URL) and deletes the file. 404 if the hotel does not have that photo.
  async removeImage(id: string, file: string) {
    const url = UPLOADS_URL_PREFIX + file;
    const updated = await this.hotels
      .findOneAndUpdate(
        { _id: id, images: url },
        { $pull: { images: url } },
        { new: true },
      )
      .lean();
    if (!updated) {
      if (!(await this.hotels.exists({ _id: id }))) {
        throw new NotFoundException(HOTEL_NOT_FOUND);
      }
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }
    await this.uploads.remove(url);
    return updated;
  }

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

  // HTL-02: the hotel page. The profile (photos, amenities, check-in and
  // check-out times, cancellation tiers, ratingAverage and ratingCount), the
  // newest 10 reviews that are not hidden (Memo's Review model), and, when
  // both dates are given, the rooms free for the whole stay from Memo's
  // freeRooms() with the same date rules as HTL-15 (checkOut after checkIn,
  // checkIn not before today in the hotel's city). Without dates the room
  // list is empty. An inactive hotel is 404.
  async details(
    id: string,
    q: HotelDetailsQueryDto = {},
  ): Promise<HotelDetails> {
    const { checkIn, checkOut } = q;
    if ((checkIn === undefined) !== (checkOut === undefined)) {
      throw dateError(
        checkIn === undefined ? 'checkIn' : 'checkOut',
        BOTH_DATES,
      );
    }
    const nights =
      checkIn && checkOut ? stayNights(checkIn, checkOut).length : 0;

    const hotel = await this.getPublic(id);
    const reviewsQuery = this.reviews
      .find(
        { hotelId: hotel._id, hidden: false },
        { rating: 1, text: 1, createdAt: 1 },
      )
      .sort({ createdAt: -1 })
      .limit(DETAILS_REVIEWS)
      .lean();

    let availableRooms: HotelDetailsRoom[] = [];
    if (checkIn && checkOut) {
      if (checkIn < (await this.search.today({ cityId: hotel.cityId }))) {
        throw dateError('checkIn', 'checkIn cannot be in the past');
      }
      const free = await this.availability.freeRooms(
        String(hotel._id),
        checkIn,
        checkOut,
      );
      availableRooms = free.map((r) => ({
        id: String(r._id),
        name: r.name,
        type: r.type,
        beds: r.beds,
        maxOccupancy: r.maxOccupancy,
        pricePerNight: r.pricePerNight,
        nights,
        totalPrice: nights * r.pricePerNight,
      }));
    }

    const reviews = (await reviewsQuery).map((r) => ({
      id: String(r._id),
      rating: r.rating,
      text: r.text,
      createdAt: (r as { createdAt?: Date }).createdAt,
    }));
    return {
      ...hotel,
      reviews,
      availableRooms,
      checkIn: checkIn ?? null,
      checkOut: checkOut ?? null,
    };
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
