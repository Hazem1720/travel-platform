import { ApiProperty } from '@nestjs/swagger';
import { CabinCategory, FlightStatus } from '../schemas/flight.schema';

// Response shapes, used only for Swagger documentation (FLT-03, FLT-04,
// GEN-06, FLT-30).

export class ZonedTimeDto {
  @ApiProperty({ example: '2026-12-01T12:30:00.000Z' })
  utc: string;

  @ApiProperty({ example: '2026-12-01T14:30', description: 'Airport time' })
  local: string;

  @ApiProperty({ example: '+02:00' })
  utcOffset: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  timeZone: string;
}

export class FlightAirportDto {
  @ApiProperty({ example: 'CAI' })
  code: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  timeZone: string;
}

export class CabinDto {
  @ApiProperty({ example: '6736d4f4c1a2b3c4d5e6fb01' })
  _id: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  category: CabinCategory;

  @ApiProperty({ example: 150 })
  totalSeats: number;

  @ApiProperty({ example: 0 })
  bookedSeats: number;

  @ApiProperty({ example: 0 })
  heldSeats: number;

  @ApiProperty({ example: 150, description: 'total - booked - held' })
  availableSeats: number;

  @ApiProperty({ example: 25000, description: 'USD cents per seat' })
  price: number;

  @ApiProperty({ example: 1 })
  freeBags: number;

  @ApiProperty({ example: 23 })
  maxKgPerBag: number;
}

export class FlightDto {
  @ApiProperty({ example: '6736d4f4c1a2b3c4d5e6fa01' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' })
  airlineId: string;

  @ApiProperty({ example: 'NP101' })
  flightNumber: string;

  @ApiProperty({ type: FlightAirportDto })
  from: FlightAirportDto;

  @ApiProperty({ type: FlightAirportDto })
  to: FlightAirportDto;

  @ApiProperty({ type: ZonedTimeDto })
  departure: ZonedTimeDto;

  @ApiProperty({
    type: ZonedTimeDto,
    example: {
      utc: '2026-12-01T14:45:00.000Z',
      local: '2026-12-01T18:45',
      utcOffset: '+04:00',
      timeZone: 'Asia/Dubai',
    },
  })
  arrival: ZonedTimeDto;

  @ApiProperty({ example: 135 })
  durationMinutes: number;

  @ApiProperty({
    example: '2026-12-01',
    description: 'Local departure date',
  })
  departureDate: string;

  @ApiProperty({ enum: FlightStatus, example: FlightStatus.SCHEDULED })
  status: FlightStatus;

  @ApiProperty({ example: true, description: 'Scheduled and not departed' })
  bookable: boolean;

  @ApiProperty({ type: [CabinDto] })
  cabins: CabinDto[];
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class FlightPageDto {
  @ApiProperty({ type: [FlightDto] })
  data: FlightDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
