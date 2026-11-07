import { ApiProperty } from '@nestjs/swagger';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import { AccountStatus, Role } from '../../common/enums/role.enum';

// Response shapes, used only for Swagger documentation.

export class UserProfileDto {
  @ApiProperty({ example: '6730b2f4c1a2b3c4d5e6f701' })
  id: string;

  @ApiProperty({ example: 'Sara Ali' })
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  email: string;

  @ApiProperty({ example: '+20 100 123 4567' })
  phone: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ enum: SUPPORTED_CURRENCIES, example: 'EGP' })
  preferredCurrency: string;

  @ApiProperty({ example: false })
  mustChangePassword: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'The airline or hotel a moderator manages',
  })
  assignedProviderId: string | null;
}

export class MessageDto {
  @ApiProperty({ example: 'Done' })
  message: string;
}
