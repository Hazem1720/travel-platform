import { ApiProperty } from '@nestjs/swagger';

// Response shapes, used only for Swagger documentation (FLT-02).

export class AirportDto {
  @ApiProperty({ example: 'FRA', description: 'IATA code' })
  code: string;

  @ApiProperty({ example: 'Frankfurt Airport' })
  name: string;

  @ApiProperty({ example: 'frankfurt' })
  cityId: string;

  @ApiProperty({ example: 'Frankfurt' })
  city: string;

  @ApiProperty({ example: 'DE' })
  countryCode: string;

  @ApiProperty({ example: 'Germany' })
  country: string;

  @ApiProperty({ example: 'Europe/Berlin', description: 'IANA time zone' })
  timeZone: string;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 8 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class AirportPageDto {
  @ApiProperty({ type: [AirportDto] })
  data: AirportDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
