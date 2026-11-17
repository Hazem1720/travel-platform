import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { MessageDto } from '../auth/dto/auth-responses.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  CreateTransportCostDto,
  UpdateTransportCostDto,
} from './dto/transport-cost.dto';
import { ID_PARAM, NOT_A_USER, NOT_FOUND } from './itineraries.controller';
import {
  TRANSPORT_DELETED,
  TRANSPORT_NOT_FOUND,
  TransportCostsService,
} from './transport-costs.service';

const ENTRY_PARAM = {
  name: 'id',
  example: '6735a1f4c1a2b3c4d5e6fc01',
  description: 'Transport cost id',
};
const ENTRY_NOT_FOUND = {
  status: 404,
  message: TRANSPORT_NOT_FOUND,
  description: "No such entry, or it is in another user's itinerary",
};
const BAD_ENTRY = {
  status: 400,
  message: 'Validation failed',
  details: { dayId: ['dayId must be a day of this itinerary'] },
  description:
    'An unknown city, a day of another itinerary, a negative amount, an ' +
    'unsupported currency or an unknown mode',
};
const EXAMPLE = {
  _id: '6735a1f4c1a2b3c4d5e6fc01',
  itineraryId: '6735a1f4c1a2b3c4d5e6f901',
  mode: 'train',
  fromCityId: 'cairo',
  toCityId: 'luxor',
  amount: 900,
  currency: 'EGP',
  dayId: '6735a1f4c1a2b3c4d5e6fa03',
};

// ITN-16: intercity transport costs of my itinerary.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller()
export class TransportCostsController {
  constructor(private readonly transport: TransportCostsService) {}

  @Post('itineraries/:id/transport-costs')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Add an intercity transport cost to a day (ITN-16)',
  })
  @ApiCreatedResponse({ schema: { example: EXAMPLE } })
  @ApiErrors(BAD_ENTRY, UNAUTHENTICATED, NOT_A_USER, NOT_FOUND)
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTransportCostDto,
  ) {
    return this.transport.add(user, id, dto);
  }

  @Patch('transport-costs/:id')
  @ApiParam(ENTRY_PARAM)
  @ApiOperation({ summary: 'Edit a transport cost (ITN-16)' })
  @ApiOkResponse({ schema: { example: EXAMPLE } })
  @ApiErrors(BAD_ENTRY, UNAUTHENTICATED, NOT_A_USER, ENTRY_NOT_FOUND)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransportCostDto,
  ) {
    return this.transport.update(user, id, dto);
  }

  @Delete('transport-costs/:id')
  @ApiParam(ENTRY_PARAM)
  @ApiOperation({ summary: 'Delete a transport cost (ITN-16)' })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: TRANSPORT_DELETED } },
  })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, ENTRY_NOT_FOUND)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.transport.remove(user, id);
  }
}
