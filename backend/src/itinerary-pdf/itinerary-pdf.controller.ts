import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { ItineraryPdfService } from './itinerary-pdf.service';

// "A week in Tokyo!" -> "a-week-in-tokyo"
export function pdfFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `itinerary-${slug || 'export'}.pdf`;
}

// ITN-28 (Memo, bonus). Its own controller under the itineraries prefix, so
// Moharm's files do not change.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('itineraries')
export class ItineraryPdfController {
  constructor(private readonly pdfs: ItineraryPdfService) {}

  @Get(':id/pdf')
  @ApiParam({ name: 'id', example: '6736a1f4c1a2b3c4d5e6f301' })
  @ApiOperation({
    summary: 'Export or print your itinerary as a PDF (ITN-28)',
    description:
      'Your own itinerary: every day with its date, city, activities and ' +
      'budget entries, the intercity transport, and the budget per ' +
      'category and in total (per currency). Same rule as GET ' +
      "/itineraries/:id: another user's itinerary answers 404.",
  })
  // The PDF type on the 200 response only, so the error examples stay JSON.
  @ApiOkResponse({
    description: 'The PDF, as a download',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not a registered user',
    },
    {
      status: 404,
      message: 'Itinerary not found',
      description: "No such itinerary, or another user's",
    },
  )
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { title, pdf } = await this.pdfs.render(user, id);
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFileName(title)}"`,
        'Content-Length': String(pdf.length),
      })
      .end(pdf);
  }
}
