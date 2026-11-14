import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import { AirportsService } from './airports.service';
import { AirportQueryDto } from './dto/airport-query.dto';
import { AirportPageDto } from './dto/airport.dto';

@ApiTags('Airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List the predefined airports (FLT-02)',
    description:
      'Read-only list loaded at setup: IATA code, name, city, country ' +
      'and IANA time zone. Filter with ?search (code, name or city id). ' +
      'Sort by code or name, e.g. name:asc (default code:asc).',
  })
  @ApiOkResponse({ type: AirportPageDto, description: 'One page of airports' })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { limit: ['limit must not be greater than 10'] },
  })
  list(@Query() q: AirportQueryDto) {
    return this.airports.list(q);
  }
}
