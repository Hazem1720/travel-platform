import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierDto } from '../../common/helpers/cancellation-tiers';
import { FlightDto } from '../../flights/dto/flight.dto';
import { FlightAirlineSummaryDto } from './flight-search-result.dto';

// Response shape of GET /api/flights/:id, used only for Swagger (FLT-17).

export class FlightDetailsAirlineDto extends FlightAirlineSummaryDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 5000,
    description: 'USD cents per extra bag (FLT-08), null if not sold',
  })
  extraBagPrice: number | null;

  @ApiProperty({ example: 2, description: 'Extra bags per passenger' })
  maxExtraBags: number;
}

// Hazem's flight shape: local times (GEN-06), duration, and every cabin with
// price, availableSeats (total - booked - held), freeBags and maxKgPerBag.
export class FlightDetailsDto extends FlightDto {
  @ApiProperty({ type: FlightDetailsAirlineDto })
  airline: FlightDetailsAirlineDto;

  @ApiProperty({
    type: [CancellationTierDto],
    example: [
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
    description: "The airline's cancellation policy (FLT-09)",
  })
  cancellationTiers: CancellationTierDto[];
}
