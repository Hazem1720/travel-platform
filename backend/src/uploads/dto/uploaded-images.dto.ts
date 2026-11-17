import { ApiProperty } from '@nestjs/swagger';

export class UploadedImagesDto {
  @ApiProperty({
    example: ['/api/uploads/3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.png'],
    description: 'Public URLs of the stored images, in upload order',
  })
  urls: string[];
}
