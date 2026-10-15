import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;
export const PASSWORD_MESSAGE =
  'Password must be 8-64 characters with at least one lowercase letter, one uppercase letter and one digit';

export class RegisterDto {
  @ApiProperty({ example: 'Sara Ali' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Passw0rdX' })
  @IsString()
  @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password: string;
}