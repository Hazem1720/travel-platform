import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { ApiErrors } from '../common/swagger/api-error.decorator';
import { BlogService } from './blog.service';

@ApiTags('Blog')
@Controller('tags')
export class TagsController {
  constructor(private readonly blogService: BlogService) {}

  // BLG-08: tags are clickable; this lists the published posts with one.
  @Get(':tag/posts')
  @Public()
  @ApiParam({ name: 'tag', example: 'travel' })
  @ApiOperation({
    summary: 'Published posts with a tag, newest first (BLG-08)',
  })
  @ApiOkResponse({
    description: 'Paginated published posts with the tag',
    schema: {
      example: {
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
    },
  })
  @ApiErrors({ status: 400, message: 'Validation failed' })
  findByTag(@Param('tag') tag: string, @Query() query: PaginationQueryDto) {
    return this.blogService.findByTag(tag, query);
  }
}
