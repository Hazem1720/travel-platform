import { BadRequestException, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { UploadedImage } from './image-file';
import { UploadsService } from './uploads.service';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const image = (name: string, buffer: Buffer) =>
  ({
    originalname: name,
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
  }) as UploadedImage;

describe('UploadsService (GEN-08)', () => {
  let dir: string;
  let service: UploadsService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'uploads-test-'));
    service = new UploadsService();
    service.dir = dir;
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores images under random names and returns their URLs', async () => {
    const urls = await service.save([
      image('a.png', PNG_BYTES),
      image('b.jpg', JPG_BYTES),
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(urls[1]).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\.jpg$/);
    const stored = await fs.readFile(join(dir, urls[0].split('/').pop()!));
    expect(stored.equals(PNG_BYTES)).toBe(true);
  });

  it('stores nothing when one file is invalid', async () => {
    await expect(
      service.save([
        image('a.png', PNG_BYTES),
        image('b.png', Buffer.from('not an image')),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(fs.readdir(dir)).resolves.toEqual([]);
  });

  it('finds a stored file and removes it', async () => {
    const [url] = await service.save([image('a.png', PNG_BYTES)]);
    const name = url.split('/').pop()!;
    await expect(service.pathOf(name)).resolves.toBe(join(dir, name));
    await service.remove(url);
    await expect(service.pathOf(name)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(url)).resolves.toBeUndefined();
  });

  it('never reads or deletes a name it did not generate', async () => {
    await fs.writeFile(join(dir, 'secret.txt'), 'x');
    await expect(service.pathOf('../.env')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.pathOf('secret.txt')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.remove('/api/uploads/secret.txt');
    await expect(fs.readdir(dir)).resolves.toEqual(['secret.txt']);
  });
});
