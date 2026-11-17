import { Global, Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

// GEN-08. Global, so any module can inject UploadsService without importing
// this module. For a route: @ImageUpload(field, IMAGE_LIMITS.X) and
// @UploadedFiles(), then UploadsService.save(files) (see the controller).
@Global()
@Module({
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
