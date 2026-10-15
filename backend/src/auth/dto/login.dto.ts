import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'sara@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Passw0rdX' })
  @IsString()
  @IsNotEmpty()
  password: string;
}