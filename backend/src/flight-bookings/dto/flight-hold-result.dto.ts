import { ApiProperty } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { CabinCategory } from '../../flights/schemas/flight.schema';
import { PassengerDto } from './flight-quote.dto';

// Response of POST /api/flight-bookings/hold (FLT-22), for Swagger only.

export class BookingSegmentDto {
  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f101' }) flightId: string;
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' }) airlineId: string;
  @ApiProperty({ example: 'NP101' }) flightNumber: string;
  @ApiProperty({ example: 'CAI' }) from: string;
  @ApiProperty({ example: 'DXB' }) to: string;
  @ApiProperty({ example: '2026-12-01T22:30:00.000Z' }) departureAt: string;
  @ApiProperty({ example: '2026-12-02T02:30:00.000Z' }) arrivalAt: string;
  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f1c1' }) cabinId: string;
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  cabin: CabinCategory;
  @ApiProperty({ example: 2, description: 'Seats held (adults and children)' })
  seats: number;
  @ApiProperty({ example: 20000 }) cabinFare: number;
  @ApiProperty({ example: 42000 }) fares: number;
  @ApiProperty({ example: 5000 }) baggageFees: number;
  @ApiProperty({ example: 47000 }) subtotal: number;
}

export class FlightHoldResultDto {
  @ApiProperty({ example: '6737b2f4c1a2b3c4d5e6f201' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f702' })
  userId: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'FL-XXXXXXXX once paid (FLT-23)',
  })
  reference: string | null;

  @ApiProperty({
    enum: BookingStatus,
    example: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  @ApiProperty({ type: [BookingSegmentDto] })
  segments: BookingSegmentDto[];

  @ApiProperty({ type: [PassengerDto] })
  passengers: PassengerDto[];

  @ApiProperty({
    example: 47000,
    description: 'USD cents: the amount Stripe will charge',
  })
  totalAmount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: '2026-11-18T12:10:00.000Z',
    description: 'End of the 10-minute hold',
  })
  expiresAt: string;

  @ApiProperty({ example: null, nullable: true })
  policiesAcceptedAt: string | null;

  @ApiProperty({ example: '2026-11-18T12:00:00.000Z' })
  createdAt: string;
}
