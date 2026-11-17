import { BadRequestException } from '@nestjs/common';

// GEN-08: JPG or PNG, at most 5 MB each.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Limits from the official requirement. Pass the right one to @ImageUpload().
export const IMAGE_LIMITS = {
  POST: 5,
  ACTIVITY: 5,
  HOTEL: 5,
  AIRLINE_LOGO: 1,
} as const;

// The part of a multer file this module uses. Declared here so the project
// does not need @types/multer.
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export type ImageType = 'jpg' | 'png';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

// The real type, read from the first bytes of the file. The extension and the
// Content-Type header come from the client and are not trusted on their own.
export function detectImageType(buffer: Buffer | undefined): ImageType | null {
  if (!buffer) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.subarray(0, 3).equals(JPG_SIGNATURE)) return 'jpg';
  return null;
}

const EXTENSIONS: Record<ImageType, string[]> = {
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
};

// Throws 400 unless the file is a real JPG or PNG of at most 5 MB whose
// extension matches its content. Returns the detected type.
export function assertValidImage(file: UploadedImage): ImageType {
  const name = file.originalname ?? 'file';
  if (!file.buffer?.length) {
    throw new BadRequestException(`"${name}" is empty`);
  }
  if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException(`"${name}" is larger than 5 MB`);
  }
  const type = detectImageType(file.buffer);
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!type || !EXTENSIONS[type].includes(ext)) {
    throw new BadRequestException(`"${name}" must be a JPG or PNG image`);
  }
  return type;
}

// For a resource that collects images over several uploads (a hotel or a
// post): throws 400 when the new files would go over its limit.
//   assertImageLimit(hotel.images.length, files.length, IMAGE_LIMITS.HOTEL);
export function assertImageLimit(
  existing: number,
  adding: number,
  max: number,
): void {
  if (existing + adding > max) {
    throw new BadRequestException(
      `At most ${max} image${max === 1 ? '' : 's'} allowed ` +
        `(${existing} already uploaded)`,
    );
  }
}
