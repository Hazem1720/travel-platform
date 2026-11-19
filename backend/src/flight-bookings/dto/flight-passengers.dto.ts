import { ApiProperty, OmitType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

// FLT-29: ?page&limit only; bookings are always newest first.
export class FlightBookingsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {}

class FlightHeaderDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' }) _id: string;
  @ApiProperty({ example: 'MS777' }) flightNumber: string;
  @ApiProperty({ example: 'CAI' }) from: string;
  @ApiProperty({ example: 'CDG' }) to: string;
  @ApiProperty({ example: '2026-12-05T08:00:00.000Z' }) departureAt: string;
  @ApiProperty({ example: 'Scheduled' }) status: string;
}

class CabinSeatsDto {
  @ApiProperty({ example: 'Economy' }) category: string;
  @ApiProperty({ example: 150 }) totalSeats: number;
  @ApiProperty({ example: 42 }) bookedSeats: number;
  @ApiProperty({ example: 2, description: 'In 10-minute payment holds' })
  heldSeats: number;
  @ApiProperty({ example: 106, description: 'total - booked - held' })
  remainingSeats: number;
}

class PassengerNameDto {
  @ApiProperty({ example: 'Sara Ali' }) fullName: string;
  @ApiProperty({ example: 'adult' }) type: string;
}

class FlightBookingRowDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb10' }) _id: string;
  @ApiProperty({ example: 'FL-7K2M9QX4' }) reference: string;
  @ApiProperty({
    example: 'Confirmed',
    description: 'Confirmed, Completed or Cancelled',
  })
  status: string;
  @ApiProperty({ example: 'Economy', description: 'Cabin on this flight' })
  cabin: string;
  @ApiProperty({
    example: 2,
    description: 'Seats on this flight (infants take none)',
  })
  seats: number;
  @ApiProperty({ type: [PassengerNameDto] }) passengers: PassengerNameDto[];
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

// FLT-29: GET /flights/:id/bookings
export class FlightBookingsPageDto {
  @ApiProperty({ type: FlightHeaderDto }) flight: FlightHeaderDto;
  @ApiProperty({
    type: [CabinSeatsDto],
    description: 'Seats remaining per category',
  })
  seats: CabinSeatsDto[];
  @ApiProperty({ type: [FlightBookingRowDto], description: 'Newest first' })
  data: FlightBookingRowDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}
