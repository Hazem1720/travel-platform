import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccountStatus, Role } from '../../common/enums/role.enum';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export const ACCOUNT_SORT_FIELDS = ['name', 'email', 'createdAt'];

// ACC-14: GET /admin/accounts?page&search&role&status&sort
export class AccountQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'sara',
    description: 'Part of the name or email, case-insensitive',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: Role, example: Role.AIRLINE_MODERATOR })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({
    example: 'createdAt:desc',
    description:
      'name, email or createdAt (registration date), with :asc or :desc. ' +
      'Default createdAt:desc (newest first).',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
