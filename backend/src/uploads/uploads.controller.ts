import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { UploadedImagesDto } from './dto/uploaded-images.dto';
import { UploadedImage } from './image-file';
import { ImageUpload } from './image-upload.decorator';
import { UploadsService } from './uploads.service';

const MAX_TEST_UPLOAD = 5;

@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  // The example every module's upload route copies: @ImageUpload() for the
  // interceptor and the Swagger form, then UploadsService.save().
  @Post('images')
  @ImageUpload('images', MAX_TEST_UPLOAD)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Upload up to 5 JPG or PNG images of at most 5 MB (GEN-08)',
    description:
      'Shows the shared upload rules in Swagger. Hotel photos, airline logos, ' +
      'activity and post images use the same rules on their own routes.',
  })
  @ApiCreatedResponse({ type: UploadedImagesDto })
  @ApiErrors(
    {
      status: 400,
      message: '"notes.png" must be a JPG or PNG image',
      description:
        'Not a JPG or PNG (checked from the file content), larger than 5 MB, ' +
        'no file, or more than 5 files',
    },
    UNAUTHENTICATED,
    MUST_CHANGE_PASSWORD,
  )
  async upload(
    @UploadedFiles() files: UploadedImage[],
  ): Promise<UploadedImagesDto> {
    return { urls: await this.uploads.save(files) };
  }

  @Get(':file')
  @Public()
  @ApiParam({
    name: 'file',
    example: '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.png',
  })
  @ApiOperation({ summary: 'Get an uploaded image by its URL (GEN-08)' })
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOkResponse({ description: 'The image file' })
  @ApiErrors({ status: 404, message: 'File not found' })
  async get(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const path = await this.uploads.pathOf(file);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path);
  }
}
