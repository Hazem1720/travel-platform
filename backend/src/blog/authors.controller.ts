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
import { AuthorsService } from './authors.service';

@ApiTags('Blog')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  // BLG-12: Get a public author profile.
  @Get(':id')
  @Public()
  @ApiOperation({
    summary:
      'Get an author profile with published posts and public itineraries (BLG-12)',
  })
  @ApiParam({ name: 'id', example: '6736e5f4c1a2b3c4d5e6f001' })
  @ApiOkResponse({
    description: 'Author profile with paginated posts and itineraries',
    schema: {
      example: {
        author: {
          id: '507f1f77bcf86cd799439011',
          name: 'John',
          joinedAt: '2026-01-01T00:00:00.000Z',
        },
        posts: {
          data: [],
          meta: {
            page: 1,
            limit: 10,
            total: 0,
            totalPages: 0,
          },
        },
        itineraries: {
          data: [],
          meta: {
            page: 1,
            limit: 10,
            total: 0,
            totalPages: 0,
          },
        },
      },
    },
  })
  @ApiErrors({
    status: 404,
    message: 'Author not found',
  })
  findProfile(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.authorsService.findProfile(id, query);
  }
}
