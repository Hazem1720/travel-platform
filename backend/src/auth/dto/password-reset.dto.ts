import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsHexadecimal,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from './register.dto';

// ACC-07 (bonus): POST /api/auth/forgot-password
export class ForgotPasswordDto {
  @ApiProperty({ example: 'sara@example.com' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;
}

// ACC-07 (bonus): POST /api/auth/reset-password
export class ResetPasswordDto {
  @ApiProperty({
    example: '3f2b8c1e6a8d4e0f9b1a2c3d4e5f6a7b3f2b8c1e6a8d4e0f9b1a2c3d4e5f6a7b',
    description: 'The token from the emailed link',
  })
  @IsString()
  @IsHexadecimal({ message: 'token is not a valid link token' })
  @Length(64, 64, { message: 'token is not a valid link token' })
  token: string;

  @ApiProperty({ example: 'NewPassw0rd1' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

// ACC-02 (bonus): GET /api/auth/verify-email?token=
export class VerifyEmailQueryDto {
  @ApiProperty({
    example: '3f2b8c1e6a8d4e0f9b1a2c3d4e5f6a7b3f2b8c1e6a8d4e0f9b1a2c3d4e5f6a7b',
    description: 'The token from the emailed link',
  })
  @IsString()
  @IsHexadecimal({ message: 'token is not a valid link token' })
  @Length(64, 64, { message: 'token is not a valid link token' })
  token: string;
}
