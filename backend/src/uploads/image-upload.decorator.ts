import {
  applyDecorators,
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  mixin,
  NestInterceptor,
  Type,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { assertValidImage, MAX_IMAGE_BYTES, UploadedImage } from './image-file';

// GEN-08: reads up to `maxCount` images from the multipart field `field` into
// memory and rejects the request with 400 (shared error format) when a file
// is not a JPG or PNG, is larger than 5 MB, or there are too many files.
// Nothing is written to disk here: call UploadsService.save(files) in the
// handler once your own checks pass.
export function ImageUploadInterceptor(
  field: string,
  maxCount: number,
): Type<NestInterceptor> {
  const Multer = FilesInterceptor(field, maxCount, {
    // One byte over the limit is enough for multer to report the file as too
    // large; assertValidImage() checks the exact limit.
    limits: { fileSize: MAX_IMAGE_BYTES + 1, files: maxCount },
  });

  class ImageInterceptor implements NestInterceptor {
    private readonly multer = new Multer();

    async intercept(
      ctx: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      let handled: Observable<unknown>;
      try {
        handled = await this.multer.intercept(ctx, next);
      } catch (err) {
        throw toBadRequest(err, field, maxCount);
      }

      const files: UploadedImage[] = ctx.switchToHttp().getRequest().files;
      if (!files?.length) {
        throw new BadRequestException(
          `Upload at least one image in the "${field}" field`,
        );
      }
      files.forEach(assertValidImage);
      return handled;
    }
  }
  return mixin(ImageInterceptor);
}

function toBadRequest(err: unknown, field: string, max: number): unknown {
  if (!(err instanceof HttpException)) return err;
  if (err.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
    return new BadRequestException('Each image must be at most 5 MB');
  }
  // multer reports both a wrong field name and too many files this way.
  if (/unexpected field|too many files/i.test(err.message)) {
    return new BadRequestException(
      `Upload at most ${max} image${max === 1 ? '' : 's'} ` +
        `in the "${field}" field`,
    );
  }
  return err;
}

// Everything a route needs: the interceptor and the Swagger form.
// Read the files with @UploadedFiles() files: UploadedImage[].
//
//   @Post(':id/images')
//   @ImageUpload('images', IMAGE_LIMITS.HOTEL)
//   addImages(@UploadedFiles() files: UploadedImage[]) { ... }
export function ImageUpload(field: string, maxCount: number) {
  return applyDecorators(
    UseInterceptors(ImageUploadInterceptor(field, maxCount)),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      description: `Up to ${maxCount} JPG or PNG image${
        maxCount === 1 ? '' : 's'
      }, at most 5 MB each (GEN-08)`,
      schema: {
        type: 'object',
        required: [field],
        properties: {
          [field]: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
            maxItems: maxCount,
          },
        },
      },
    }),
  );
}
