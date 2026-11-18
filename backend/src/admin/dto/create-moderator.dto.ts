import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from '../../auth/dto/register.dto';
import { Role } from '../../common/enums/role.enum';

export const MODERATOR_ROLES = [
  Role.AIRLINE_MODERATOR,
  Role.HOTEL_MODERATOR,
] as const;
export type ModeratorRole = (typeof MODERATOR_ROLES)[number];

// ACC-13: the admin creates a moderator linked to exactly one airline or
// hotel, with a temporary password the moderator must change on first login.
export class CreateModeratorDto {
  @ApiProperty({ example: 'TEST Nile Air Moderator' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'nile.moderator@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @ApiProperty({ enum: MODERATOR_ROLES, example: Role.AIRLINE_MODERATOR })
  @IsIn(MODERATOR_ROLES, {
    message: `role must be one of: ${MODERATOR_ROLES.join(', ')}`,
  })
  role: ModeratorRole;

  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f701',
    description: 'The airline (airline_moderator) or hotel (hotel_moderator)',
  })
  @IsMongoId()
  providerId: string;

  @ApiProperty({
    example: 'TempPass123',
    description: 'At least 8 characters with a letter and a digit',
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  temporaryPassword: string;
}
