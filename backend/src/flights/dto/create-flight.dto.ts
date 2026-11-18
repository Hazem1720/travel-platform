import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const FLIGHT_NUMBER = /^[A-Z0-9]{2,3}[0-9]{1,4}$/;
export const IATA_CODE = /^[A-Z]{3}$/;
// A local date and time without an offset, as entered at the airport.
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// FLT-03. The airline is the moderator's own (assignedProviderId), never a
// field of the body. Times are in each airport's local time (GEN-06).
export class CreateFlightDto {
  @ApiProperty({
    example: 'NP101',
    description: 'Airline code (2-3) then 1-4 digits, stored uppercase',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(FLIGHT_NUMBER, {
    message: 'flightNumber must be an airline code and digits, such as NP101',
  })
  flightNumber: string;

  @ApiProperty({ example: 'CAI', description: 'Departure airport (IATA)' })
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, { message: 'from must be a 3-letter IATA code' })
  from: string;

  @ApiProperty({ example: 'DXB', description: 'Arrival airport (IATA)' })
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, { message: 'to must be a 3-letter IATA code' })
  to: string;

  @ApiProperty({
    example: '2026-12-01T14:30',
    description: 'Local time at the departure airport, no offset',
  })
  @IsString()
  @Matches(LOCAL_DATE_TIME, {
    message:
      'departureLocal must be a local date and time such as 2026-12-01T14:30',
  })
  departureLocal: string;

  @ApiProperty({
    example: '2026-12-01T18:45',
    description: 'Local time at the arrival airport, no offset',
  })
  @IsString()
  @Matches(LOCAL_DATE_TIME, {
    message:
      'arrivalLocal must be a local date and time such as 2026-12-01T18:45',
  })
  arrivalLocal: string;
}
