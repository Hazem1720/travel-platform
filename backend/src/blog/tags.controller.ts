
import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { BlogService } from './blog.service';

@ApiTags('Blog Tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly blogService: BlogService) {}

  @Get(':tag/posts')
  @Public()
  @ApiOperation({
    summary: 'List published posts by tag (BLG-08)',
  })
  @ApiQuery({ type: PaginationQueryDto })
  @ApiOkResponse({
    description: 'Paginated published posts matching the requested tag',
    schema: {
      example: {
        data: [],
        meta: {
          page: 1,
          limit: 10,
          total: 0,
          totalPages: 0,
        },
      },
    },
  })
  findByTag(
  @Param('tag') tag: string,
  @Query() query: PaginationQueryDto,
): Promise<any> {
  return this.blogService.findByTag(tag, query);
}
}
