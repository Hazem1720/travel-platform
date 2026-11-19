import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { FavouriteType } from '../schemas/favourite.schema';

// BON-02: POST /favourites.
export class CreateFavouriteDto {
  @ApiProperty({ enum: FavouriteType, example: FavouriteType.HOTEL })
  @IsEnum(FavouriteType, { message: 'type must be hotel or itinerary' })
  type: FavouriteType;

  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f801',
    description: "The hotel's or the public itinerary's id",
  })
  @IsMongoId({ message: 'id must be a valid id' })
  id: string;
}

// Response shapes, used only for Swagger documentation.
class FavouriteHotelDto {
  @ApiProperty({ example: 'Nile View Hotel' }) name: string;
  @ApiProperty({ example: 'cairo' }) cityId: string;
  @ApiProperty({ example: 4 }) starClass: number;
  @ApiProperty({ example: 4.5 }) ratingAverage: number;
  @ApiProperty({
    example: '/uploads/6735a1f4c1a2b3c4d5e6f9a1.jpg',
    nullable: true,
    type: String,
  })
  image: string | null;
}

class FavouriteItineraryDto {
  @ApiProperty({ example: 'A week in Tokyo' }) title: string;
  @ApiProperty({ example: ['JP'] }) countries: string[];
  @ApiProperty({ example: '2026-12-10T00:00:00.000Z' }) startDate: Date;
  @ApiProperty({ example: 7 }) days: number;
}

export class FavouriteDto {
  @ApiProperty({ example: '6737e2b3c1a2b3c4d5e6fe01' }) _id: string;
  @ApiProperty({ enum: FavouriteType, example: FavouriteType.HOTEL })
  type: FavouriteType;
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' }) targetId: string;
  @ApiProperty({
    example: true,
    description:
      'False once the hotel is inactive or the itinerary is no longer public; ' +
      'the summary is then left out',
  })
  available: boolean;
  @ApiProperty({
    type: FavouriteHotelDto,
    nullable: true,
    description: 'For type hotel, while available',
  })
  hotel: FavouriteHotelDto | null;
  @ApiProperty({
    type: FavouriteItineraryDto,
    nullable: true,
    description: 'For type itinerary, while available',
  })
  itinerary: FavouriteItineraryDto | null;
  @ApiProperty({ example: '2026-11-19T10:00:00.000Z' }) createdAt: Date;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 2 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class FavouriteListDto {
  @ApiProperty({ type: [FavouriteDto] }) data: FavouriteDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}
