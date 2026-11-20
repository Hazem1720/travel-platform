import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { AIRLINE_CODE } from '../schemas/airline.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// FLT-01: the admin creates the profile. The logo is uploaded separately
// (GEN-08); isActive, baggage and tiers have their own routes.
export class CreateAirlineDto {
  @ApiProperty({ example: 'TEST Nile Air', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: 'NP',
    description: '2 or 3 letters or digits, stored uppercase, unique',
  })
  @Transform(trimUpper)
  @IsString()
  @Matches(AIRLINE_CODE, {
    message: 'code must be 2 or 3 letters or digits, such as MS or MSR',
  })
  code: string;
}
