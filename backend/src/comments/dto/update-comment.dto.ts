import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_COMMENT_LENGTH } from '../schemas/comment.schema';
export class UpdateCommentDto {
  @ApiProperty({
    example: 'Updated comment text',
    maxLength: MAX_COMMENT_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_COMMENT_LENGTH)
  body: string;
}
