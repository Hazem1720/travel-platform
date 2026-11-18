import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import { IATA_CODE, LOCAL_DATE_TIME } from './create-flight.dto';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// FLT-05: times in each airport's local time, as in FLT-03. Airports can
// change only while the flight has no booking. The flight number and the
// airline never change.
export class UpdateFlightDto {
  @ApiPropertyOptional({ example: 'CAI' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, { message: 'from must be a 3-letter IATA code' })
  from?: string;

  @ApiPropertyOptional({ example: 'DXB' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  @Matches(IATA_CODE, { message: 'to must be a 3-letter IATA code' })
  to?: string;

  @ApiPropertyOptional({ example: '2026-12-01T16:00' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_DATE_TIME, {
    message:
      'departureLocal must be a local date and time such as 2026-12-01T16:00',
  })
  departureLocal?: string;

  @ApiPropertyOptional({ example: '2026-12-01T20:15' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_DATE_TIME, {
    message:
      'arrivalLocal must be a local date and time such as 2026-12-01T20:15',
  })
  arrivalLocal?: string;
}
