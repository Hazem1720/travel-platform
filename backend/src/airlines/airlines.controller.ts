import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UploadedFiles,
} from '@nestjs/common';
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
import { CancellationPolicyDto } from '../common/helpers/cancellation-tiers';
import { AuthUser } from '../common/types/auth-user.type';
import { IMAGE_LIMITS, UploadedImage } from '../uploads/image-file';
import { ImageUpload } from '../uploads/image-upload.decorator';
import { AIRLINE_NOT_FOUND, AirlinesService } from './airlines.service';
import { AirlineDto } from './dto/airline.dto';
import { BaggagePolicyDto } from './dto/baggage-policy.dto';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';

const ID_PARAM = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f701' };
const DUPLICATE_CODE = {
  status: 409,
  message: 'A record with this code already exists',
  details: { code: ['must be unique'] },
};
const NOT_FOUND = { status: 404, message: AIRLINE_NOT_FOUND };
const NOT_YOUR_AIRLINE = {
  status: 403,
  message: 'You can only manage your assigned provider',
  description:
    "Not this airline's moderator (other 403s: suspended account, " +
    `or "${MUST_CHANGE_PASSWORD.message}")`,
};

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

  @Put(':id/baggage-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Set the extra baggage policy of your airline (FLT-08)',
    description:
      'Price per extra bag in USD cents (> 0) and the most extra bags per ' +
      "passenger (>= 0). An extra bag has the cabin's maxKgPerBag limit.",
  })
  @ApiOkResponse({ type: AirlineDto, description: 'The updated airline' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { extraBagPrice: ['extraBagPrice must not be less than 1'] },
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    NOT_FOUND,
  )
  setBaggagePolicy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: BaggagePolicyDto,
  ) {
    assertOwnsProvider(user, Role.AIRLINE_MODERATOR, id);
    return this.airlines.setBaggagePolicy(id, dto);
  }

  @Put(':id/cancellation-policy')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Set the cancellation tiers of your airline (FLT-09)',
    description:
      'Replaces all tiers. The refund uses the tier with the highest ' +
      'daysBefore not above the days remaining; if none applies, 0%.',
  })
  @ApiOkResponse({ type: AirlineDto, description: 'The updated airline' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { tiers: ['Each tier must have a different daysBefore'] },
      description:
        'Two tiers with the same daysBefore, refundPercent outside 0-100, ' +
        'or daysBefore not a whole number >= 0',
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    NOT_FOUND,
  )
  setCancellationPolicy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancellationPolicyDto,
  ) {
    assertOwnsProvider(user, Role.AIRLINE_MODERATOR, id);
    return this.airlines.setCancellationPolicy(id, dto);
  }

  @Post(':id/logo')
  @Roles(Role.AIRLINE_MODERATOR)
  @ImageUpload('logo', IMAGE_LIMITS.AIRLINE_LOGO)
  @ApiCookieAuth('access_token')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: "Upload your airline's logo (FLT-01, GEN-08)",
    description:
      'One JPG or PNG of at most 5 MB in the "logo" field. Replaces the ' +
      'previous logo.',
  })
  @ApiCreatedResponse({ type: AirlineDto, description: 'The updated airline' })
  @ApiErrors(
    {
      status: 400,
      message: 'Upload at most 1 image in the "logo" field',
      description: 'Not a JPG or PNG, larger than 5 MB, none, or two files',
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    NOT_FOUND,
  )
  setLogo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    assertOwnsProvider(user, Role.AIRLINE_MODERATOR, id);
    return this.airlines.setLogo(id, files);
  }
}
