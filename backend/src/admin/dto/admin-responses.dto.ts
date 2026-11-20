import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, Role } from '../../common/enums/role.enum';

// Response shapes, used only for Swagger documentation.

export class ManagedAccountDto {
  @ApiProperty({ example: '6736e5f4c1a2b3c4d5e6fc01' })
  _id: string;

  @ApiProperty({ example: 'TEST Nile Air Moderator' })
  name: string;

  @ApiProperty({ example: 'nile.moderator@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.AIRLINE_MODERATOR })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '6735a1f4c1a2b3c4d5e6f701',
  })
  assignedProviderId: string | null;

  @ApiProperty({ example: true })
  mustChangePassword: boolean;

  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' })
  createdAt: string;
}

export class ProviderStateDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' })
  _id: string;

  @ApiProperty({ example: 'TEST Nile Air' })
  name: string;

  @ApiProperty({ example: false })
  isActive: boolean;

  @ApiProperty({ example: 1, description: 'Moderators notified' })
  notified: number;
}
