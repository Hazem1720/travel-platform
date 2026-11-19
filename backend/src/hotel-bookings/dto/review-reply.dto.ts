import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const MAX_REPLY_TEXT = 1000;

// HTL-26 (bonus): POST /api/reviews/:id/reply
export class ReviewReplyDto {
  @ApiProperty({
    example: 'Thank you for staying with us, we hope to see you again!',
    maxLength: MAX_REPLY_TEXT,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_TEXT)
  text: string;
}
