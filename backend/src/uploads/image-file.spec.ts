import { BadRequestException } from '@nestjs/common';
import {
  assertImageLimit,
  assertValidImage,
  detectImageType,
  MAX_IMAGE_BYTES,
  UploadedImage,
} from './image-file';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_BYTES = Buffer.from('GIF89a....');

function image(name: string, buffer: Buffer, size = buffer.length) {
  return {
    originalname: name,
    mimetype: 'image/png',
    size,
    buffer,
  } as UploadedImage;
}

// GEN-08: JPG or PNG, checked from the file content, at most 5 MB.
describe('image rules (GEN-08)', () => {
  it('detects PNG and JPG from the first bytes', () => {
    expect(detectImageType(PNG_BYTES)).toBe('png');
    expect(detectImageType(JPG_BYTES)).toBe('jpg');
    expect(detectImageType(GIF_BYTES)).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });

  it('accepts a PNG and a JPG with matching extensions', () => {
    expect(assertValidImage(image('photo.PNG', PNG_BYTES))).toBe('png');
    expect(assertValidImage(image('photo.jpeg', JPG_BYTES))).toBe('jpg');
    expect(assertValidImage(image('photo.jpg', JPG_BYTES))).toBe('jpg');
  });

  it('rejects a GIF', () => {
    expect(() => assertValidImage(image('anim.gif', GIF_BYTES))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a text file renamed to .png', () => {
    expect(() =>
      assertValidImage(image('notes.png', Buffer.from('hello world'))),
    ).toThrow('"notes.png" must be a JPG or PNG image');
  });

  it('rejects a real PNG named .jpg', () => {
    expect(() => assertValidImage(image('photo.jpg', PNG_BYTES))).toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty file', () => {
    expect(() => assertValidImage(image('x.png', Buffer.alloc(0)))).toThrow(
      'is empty',
    );
  });

  it('accepts exactly 5 MB and rejects anything larger', () => {
    const ok = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES - 10)]);
    expect(assertValidImage(image('big.png', ok))).toBe('png');
    const tooBig = Buffer.concat([ok, Buffer.alloc(1)]);
    expect(() => assertValidImage(image('big.png', tooBig))).toThrow(
      'larger than 5 MB',
    );
  });

  it('limits images collected over several uploads', () => {
    expect(() => assertImageLimit(3, 2, 5)).not.toThrow();
    expect(() => assertImageLimit(4, 2, 5)).toThrow(
      'At most 5 images allowed (4 already uploaded)',
    );
    expect(() => assertImageLimit(1, 1, 1)).toThrow('At most 1 image allowed');
  });
});
