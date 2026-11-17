import { ApiProperty } from '@nestjs/swagger';
import { ItineraryVisibility } from '../schemas/itinerary.schema';

// Response shapes, used only for Swagger documentation.
export class ItineraryDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f001' })
  ownerId: string;

  @ApiProperty({ example: 'TEST Egypt in winter' })
  title: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-01T00:00:00.000Z' })
  startDate: string;

  @ApiProperty({
    enum: ItineraryVisibility,
    example: ItineraryVisibility.PRIVATE,
  })
  visibility: ItineraryVisibility;

  @ApiProperty({ example: false })
  hidden: boolean;

  @ApiProperty({ type: [Object], example: [] })
  days: object[];

  @ApiProperty({ nullable: true, example: null })
  clonedFrom: object | null;

  @ApiProperty({ example: '2026-11-17T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-17T10:00:00.000Z' })
  updatedAt: string;
}

// ITN-03: one row of "my itineraries".
export class ItinerarySummaryDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  _id: string;

  @ApiProperty({ example: 'TEST Egypt in winter' })
  title: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({ example: '2026-12-01T00:00:00.000Z' })
  startDate: string;

  @ApiProperty({ example: 5, description: 'Number of days' })
  dayCount: number;

  @ApiProperty({
    enum: ItineraryVisibility,
    example: ItineraryVisibility.PRIVATE,
  })
  visibility: ItineraryVisibility;

  @ApiProperty({ example: '2026-11-17T10:00:00.000Z' })
  updatedAt: string;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class ItineraryListDto {
  @ApiProperty({ type: [ItinerarySummaryDto] })
  data: ItinerarySummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
