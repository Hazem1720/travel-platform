import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AIRLINE_NOT_FOUND, AirlinesService } from './airlines.service';
import { AirlineDto } from './dto/airline.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

const ID_PARAM = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f701' };
const DUPLICATE_CODE = {
  status: 409,
  message: 'A record with this code already exists',
  details: { code: ['must be unique'] },
};
const NOT_FOUND = { status: 404, message: AIRLINE_NOT_FOUND };

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Create an airline profile, admin only (FLT-01)' })
  @ApiCreatedResponse({ type: AirlineDto, description: 'The new airline' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        code: ['code must be 2 or 3 letters or digits, such as MS or MSR'],
      },
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not an admin, or the account is suspended',
    },
    DUPLICATE_CODE,
  )
  create(@Body() dto: CreateAirlineDto) {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @Public()
  @ApiParam(ID_PARAM)
  @ApiOperation({ summary: "View an airline's profile (FLT-01)" })
  @ApiOkResponse({ type: AirlineDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Invalid value for "_id"',
      details: { _id: ['"abc" is not valid'] },
    },
    NOT_FOUND,
  )
  get(@Param('id') id: string) {
    return this.airlines.get(id);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: "Edit your airline's name or code, its moderator only (FLT-01)",
  })
  @ApiOkResponse({ type: AirlineDto, description: 'The updated airline' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { name: ['name should not be empty'] },
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You can only manage your assigned provider',
      description:
        "Not this airline's moderator (other 403s: suspended account, " +
        `or "${MUST_CHANGE_PASSWORD.message}")`,
    },
    NOT_FOUND,
    DUPLICATE_CODE,
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAirlineDto,
  ) {
    assertOwnsProvider(user, Role.AIRLINE_MODERATOR, id);
    return this.airlines.update(id, dto);
  }
}
