import { ApiProperty } from '@nestjs/swagger';
import { FlightDto } from '../../flights/dto/flight.dto';

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

// Hazem's flight shape (local times, duration, cabins) plus the airline.
// cabins lists only the cabins with enough free seats for the passengers.
export class FlightOptionDto extends FlightDto {
  @ApiProperty({ type: FlightAirlineSummaryDto })
  airline: FlightAirlineSummaryDto;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class FlightSearchResultDto {
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
