import { ApiProperty, OmitType } from '@nestjs/swagger';
import { CabinDto, FlightDto } from '../../flights/dto/flight.dto';

// Response shapes for GET /api/flights/search, used only for Swagger (FLT-11).

export class FlightAirlineSummaryDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' })
  _id: string;

  @ApiProperty({ example: 'Nile Air' })
  name: string;

  @ApiProperty({ example: 'NP' })
  code: string;

  @ApiProperty({
    example: '/api/uploads/3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.png',
    nullable: true,
  })
  logo: string | null;
}

// A cabin in the public search and details: no bookedSeats or heldSeats.
export class PublicCabinDto extends OmitType(CabinDto, [
  'bookedSeats',
  'heldSeats',
] as const) {}

export class CabinOptionDto extends PublicCabinDto {
  @ApiProperty({
    example: 42000,
    description:
      'What these passengers pay in this cabin before extra bags, USD ' +
      'cents (infants 10%)',
  })
  totalFare: number;
}

// Hazem's flight shape (local times, duration) plus the airline. cabins
// lists only the cabins with enough free seats for the passengers (and of
// the chosen ?cabin).
export class FlightOptionDto extends OmitType(FlightDto, ['cabins'] as const) {
  @ApiProperty({ type: FlightAirlineSummaryDto })
  airline: FlightAirlineSummaryDto;

  @ApiProperty({ type: [CabinOptionDto] })
  cabins: CabinOptionDto[];

  @ApiProperty({
    example: 20000,
    description:
      'Cheapest listed cabin per seat, USD cents, used by sort=price. ' +
      'minPrice and maxPrice leave out the cabins outside the range ' +
      '(FLT-15).',
  })
  lowestPrice: number;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class FlightOptionListDto {
  @ApiProperty({ type: [FlightOptionDto] })
  data: FlightOptionDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;

  @ApiProperty({
    example: null,
    nullable: true,
    description: '"No flights found" when the list is empty',
  })
  message: string | null;
}

// data/meta/message are the outbound flights.
export class FlightSearchResultDto extends FlightOptionListDto {
  @ApiProperty({
    type: FlightOptionListDto,
    nullable: true,
    description:
      'Round trip (?returnDate, FLT-12): the flights back, to -> from on ' +
      'returnDate. null for a one-way search.',
  })
  returnFlights: FlightOptionListDto | null;
}
