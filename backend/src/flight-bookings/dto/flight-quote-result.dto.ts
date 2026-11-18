import { ApiProperty } from '@nestjs/swagger';
import { FlightAirportDto, ZonedTimeDto } from '../../flights/dto/flight.dto';
import { CabinCategory } from '../../flights/schemas/flight.schema';
import { PassengerType } from '../flight-booking.rules';
import { PassengerDto } from './flight-quote.dto';
import { FlightAirlineSummaryDto } from './flight-search-result.dto';

// Response of POST /api/flight-bookings (FLT-19, FLT-21), for Swagger only.

export class QuoteSegmentDto {
  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f101' })
  flightId: string;

  @ApiProperty({ example: 'NP101' })
  flightNumber: string;

  @ApiProperty({ type: FlightAirlineSummaryDto })
  airline: FlightAirlineSummaryDto;

  @ApiProperty({ type: FlightAirportDto })
  from: FlightAirportDto;

  @ApiProperty({ type: FlightAirportDto })
  to: FlightAirportDto;

  @ApiProperty({ type: ZonedTimeDto })
  departure: ZonedTimeDto;

  @ApiProperty({ type: ZonedTimeDto })
  arrival: ZonedTimeDto;

  @ApiProperty({ example: 240 })
  durationMinutes: number;

  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f1c1' })
  cabinId: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  cabin: CabinCategory;

  @ApiProperty({ example: 20000, description: 'Per seat, USD cents' })
  cabinFare: number;

  @ApiProperty({ example: 1, description: 'Free checked bags per passenger' })
  freeBags: number;

  @ApiProperty({ example: 23 })
  maxKgPerBag: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 5000,
    description: 'USD cents per extra bag, null if the airline sells none',
  })
  extraBagPrice: number | null;
}

export class PassengerPriceDto {
  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  type: PassengerType;

  @ApiProperty({ example: 20000, description: 'Infants pay 10%' })
  fare: number;

  @ApiProperty({ example: 1 })
  extraBags: number;

  @ApiProperty({ example: 5000 })
  baggageFee: number;
}

export class SegmentPriceDto {
  @ApiProperty({
    type: [PassengerPriceDto],
    description: 'Same order as passengers',
  })
  passengers: PassengerPriceDto[];

  @ApiProperty({ example: 42000 })
  fares: number;

  @ApiProperty({ example: 5000 })
  baggageFees: number;

  @ApiProperty({ example: 47000 })
  subtotal: number;
}

export class PriceBreakdownDto {
  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    type: [SegmentPriceDto],
    description: 'Same order as segments',
  })
  segments: SegmentPriceDto[];

  @ApiProperty({ example: 42000 })
  fares: number;

  @ApiProperty({ example: 5000 })
  baggageFees: number;

  @ApiProperty({
    example: 47000,
    description: 'USD cents: what the hold stores and Stripe charges',
  })
  total: number;
}

class PassengerCountsDto {
  @ApiProperty({ example: 2 }) adults: number;
  @ApiProperty({ example: 0 }) children: number;
  @ApiProperty({ example: 1 }) infants: number;
}

export class FlightQuoteResultDto {
  @ApiProperty({
    type: [QuoteSegmentDto],
    description: 'Outbound, then the return flight for a round trip',
  })
  segments: QuoteSegmentDto[];

  @ApiProperty({ type: [PassengerDto] })
  passengers: PassengerDto[];

  @ApiProperty({ type: PassengerCountsDto })
  counts: PassengerCountsDto;

  @ApiProperty({
    example: 2,
    description: 'Seats taken on each flight (infants take none)',
  })
  seats: number;

  @ApiProperty({ type: PriceBreakdownDto })
  price: PriceBreakdownDto;
}
