import { ApiProperty } from '@nestjs/swagger';
import { FlightDto } from '../../flights/dto/flight.dto';

// FLT-06: the answer to POST /flights/:id/cancel.
export class CancelFlightResultDto {
  @ApiProperty({ type: FlightDto, description: 'The flight, now Cancelled' })
  flight: FlightDto;

  @ApiProperty({
    example: 12,
    description:
      'Confirmed bookings cancelled, each refunded 100% and notified',
  })
  cancelledBookings: number;

  @ApiProperty({ example: 624000, description: 'Total refunded, USD cents' })
  refundedAmount: number;

  @ApiProperty({
    example: 1,
    description: 'Unpaid holds released (their seats freed, payment cancelled)',
  })
  releasedHolds: number;

  @ApiProperty({
    example: [],
    type: [String],
    description:
      'Bookings that could not be fully processed (logged; an admin can follow up)',
  })
  problems: string[];
}
