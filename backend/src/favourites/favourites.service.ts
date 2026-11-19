import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  buildSort,
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { CreateFavouriteDto } from './dto/favourite.dto';
import {
  Favourite,
  FavouriteDocument,
  FavouriteType,
  LeanFavourite,
} from './schemas/favourite.schema';

export const HOTEL_NOT_FOUND = 'Hotel not found';
export const ITINERARY_NOT_FOUND = 'Itinerary not found';
export const ALREADY_SAVED = 'Already in your favourites';
export const FAVOURITE_NOT_FOUND = 'Favourite not found';

interface HotelSummary {
  name: string;
  cityId: string;
  starClass: number;
  ratingAverage: number;
  image: string | null;
}

interface ItinerarySummary {
  title: string;
  countries: string[];
  startDate: Date;
  days: number;
}

export interface FavouriteView {
  _id: string;
  type: FavouriteType;
  targetId: string;
  available: boolean;
  hotel: HotelSummary | null;
  itinerary: ItinerarySummary | null;
  createdAt?: Date;
}

type LeanHotel = Hotel & { _id: Types.ObjectId };

// BON-02 (Memo): a registered user's favourites list of hotels and public
// itineraries. Only an active hotel or a public itinerary can be saved.
// Moharm's PublicItinerariesService.findPublic decides what is public
// (Public, not hidden, author not deactivated), the same rule as his
// public pages (ITN-21).
@Injectable()
export class FavouritesService {
  constructor(
    @InjectModel(Favourite.name)
    private readonly favourites: Model<FavouriteDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  async add(user: AuthUser, dto: CreateFavouriteDto): Promise<FavouriteView> {
    const summary =
      dto.type === FavouriteType.HOTEL
        ? { hotel: await this.activeHotel(dto.id), itinerary: null }
        : { hotel: null, itinerary: await this.publicItinerary(dto.id) };
    if (!summary.hotel && !summary.itinerary) {
      throw new NotFoundException(
        dto.type === FavouriteType.HOTEL
          ? HOTEL_NOT_FOUND
          : ITINERARY_NOT_FOUND,
      );
    }
    try {
      const created = await this.favourites.create({
        userId: new Types.ObjectId(user.id),
        type: dto.type,
        targetId: new Types.ObjectId(dto.id),
      });
      return toView(created.toObject(), summary);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException(ALREADY_SAVED);
      }
      throw err;
    }
  }

  // The user's favourites, newest first, 10 per page (GEN-05). An entry
  // whose hotel became inactive or whose itinerary is no longer public
  // stays listed (so it can be removed) with available: false and no
  // summary, so nothing private is shown.
  async list(
    user: AuthUser,
    { page, limit, sort }: PaginationQueryDto,
  ): Promise<PaginatedResult<FavouriteView>> {
    const filter = { userId: new Types.ObjectId(user.id) };
    const [items, total] = await Promise.all([
      this.favourites
        .find(filter)
        .sort(buildSort(sort, []))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanFavourite[]>(),
      this.favourites.countDocuments(filter),
    ]);

    const hotelIds = items
      .filter((f) => f.type === FavouriteType.HOTEL)
      .map((f) => f.targetId);
    const hotels = hotelIds.length
      ? await this.hotels
          .find({ _id: { $in: hotelIds }, isActive: true })
          .lean<LeanHotel[]>()
      : [];
    const hotelById = new Map(hotels.map((h) => [String(h._id), h]));

    const data = await Promise.all(
      items.map(async (f) =>
        f.type === FavouriteType.HOTEL
          ? toView(f, {
              hotel: hotelSummary(hotelById.get(String(f.targetId))),
              itinerary: null,
            })
          : toView(f, {
              hotel: null,
              itinerary: await this.publicItinerary(String(f.targetId)),
            }),
      ),
    );
    return paginated(data, total, page, limit);
  }

  // Only the user's own favourite; anyone else's is 404.
  async remove(user: AuthUser, id: string): Promise<void> {
    const res = isValidObjectId(id)
      ? await this.favourites.deleteOne({
          _id: new Types.ObjectId(id),
          userId: new Types.ObjectId(user.id),
        })
      : { deletedCount: 0 };
    if (res.deletedCount === 0) {
      throw new NotFoundException(FAVOURITE_NOT_FOUND);
    }
  }

  private async activeHotel(id: string): Promise<HotelSummary | null> {
    if (!isValidObjectId(id)) return null;
    const hotel = await this.hotels
      .findOne({ _id: id, isActive: true })
      .lean<LeanHotel>();
    return hotelSummary(hotel ?? undefined);
  }

  // null if the itinerary is not (or no longer) public.
  private async publicItinerary(id: string): Promise<ItinerarySummary | null> {
    if (!isValidObjectId(id)) return null;
    try {
      const it = await this.publicItineraries.findPublic(id);
      return {
        title: it.title,
        countries: it.countries ?? [],
        startDate: it.startDate,
        days: it.days?.length ?? 0,
      };
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}

function hotelSummary(hotel: LeanHotel | undefined): HotelSummary | null {
  if (!hotel) return null;
  return {
    name: hotel.name,
    cityId: hotel.cityId,
    starClass: hotel.starClass,
    ratingAverage: hotel.ratingAverage ?? 0,
    image: hotel.images?.[0] ?? null,
  };
}

function toView(
  f: LeanFavourite,
  summary: { hotel: HotelSummary | null; itinerary: ItinerarySummary | null },
): FavouriteView {
  return {
    _id: String(f._id),
    type: f.type,
    targetId: String(f.targetId),
    available: !!(summary.hotel || summary.itinerary),
    hotel: summary.hotel,
    itinerary: summary.itinerary,
    createdAt: f.createdAt,
  };
}
