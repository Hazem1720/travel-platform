import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from '../../auth/dto/register.dto';

// ACC-07a: POST /admin/accounts/:id/reset-password. The temporary password
// follows the same rule as every password (conventions.md).
export class ResetPasswordDto {
  @ApiProperty({
    example: 'TempPass123',
    description:
      'Temporary password: at least 8 characters with a letter and a digit. ' +
      'The account must replace it at its next login.',
  })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  temporaryPassword: string;
}
