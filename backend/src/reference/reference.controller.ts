import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import { AttractionQueryDto, CityQueryDto } from './dto/reference-query.dto';
import { ReferenceService } from './reference.service';

const VALIDATION = { status: 400, message: 'Validation failed' };
const page = (example: object) => ({
  schema: {
    example: {
      data: [example],
      meta: { page: 1, limit: 10, total: 8, totalPages: 1 },
    },
  },
});

// GEN-12: the reference data seeded at setup, read-only and public. Airports
// are at GET /api/airports (FLT-02).
@ApiTags('Reference data')
@Controller('reference')
export class ReferenceController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('countries')
  @Public()
  @ApiOperation({ summary: 'Countries with their currency (GEN-12)' })
  @ApiOkResponse({
    description: 'Countries by name',
    ...page({ _id: 'EG', name: 'Egypt', currency: 'EGP' }),
  })
  @ApiErrors(VALIDATION)
  countries(@Query() q: PaginationQueryDto) {
    return this.reference.listCountries(q);
  }

  @Get('cities')
  @Public()
  @ApiOperation({ summary: 'Cities, optionally of one country (GEN-12)' })
  @ApiOkResponse({
    description: 'Cities by name',
    ...page({ _id: 'cairo', name: 'Cairo', countryCode: 'EG' }),
  })
  @ApiErrors(VALIDATION)
  cities(@Query() q: CityQueryDto) {
    return this.reference.listCities(q);
  }

  @Get('attractions')
  @Public()
  @ApiOperation({ summary: 'Attractions, optionally of one city (GEN-12)' })
  @ApiOkResponse({
    description: 'Attractions by name',
    ...page({
      _id: 'att-1',
      name: 'Giza Pyramids and Sphinx',
      cityId: 'cairo',
    }),
  })
  @ApiErrors(VALIDATION)
  attractions(@Query() q: AttractionQueryDto) {
    return this.reference.listAttractions(q);
  }

  @Get('currencies')
  @Public()
  @ApiOperation({
    summary: 'Supported currencies and the countries that use them (GEN-12)',
  })
  @ApiOkResponse({
    description: 'Currencies by code',
    ...page({ _id: 'EUR', countries: ['DE', 'FR'] }),
  })
  @ApiErrors(VALIDATION)
  currencies(@Query() q: PaginationQueryDto) {
    return this.reference.listCurrencies(q);
  }
}
