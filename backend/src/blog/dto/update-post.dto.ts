import { PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

// BLG-04 and BLG-08: any of title, body, tags and status.
export class UpdatePostDto extends PartialType(CreatePostDto) {}
