import { ApiProperty } from '@nestjs/swagger';
import { AccountStatus, Role } from '../../common/enums/role.enum';

// Response shapes, used only for Swagger documentation (ACC-14).

export class AccountDto {
  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f701',
    description: 'Use it for the suspend and reset routes',
  })
  _id: string;

  @ApiProperty({ example: 'Sara Ahmed' })
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  email: string;

  @ApiProperty({ enum: Role, example: Role.USER })
  role: Role;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: "A moderator's airline or hotel id; null for other roles",
  })
  assignedProviderId: string | null;

  @ApiProperty({
    example: '2026-11-08T10:00:00.000Z',
    description: 'Registration date',
  })
  createdAt: Date;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class AccountPageDto {
  @ApiProperty({ type: [AccountDto] })
  data: AccountDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
