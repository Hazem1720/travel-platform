import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { assertValidImage, UploadedImage } from './image-file';

// Files live in backend/uploads (git-ignored) and are served publicly at
// GET /api/uploads/:file.
export const UPLOADS_DIR = join(process.cwd(), 'uploads');
export const UPLOADS_URL_PREFIX = '/api/uploads/';

// A name this service generated: a UUID and .jpg or .png. Anything else
// (for example "../.env") is never read or deleted.
const FILE_NAME = /^[0-9a-f-]{36}\.(jpg|png)$/;

@Injectable()
export class UploadsService {
  // Replaced in unit tests with a temporary folder.
  dir = UPLOADS_DIR;

  // GEN-08: stores the images under random names and returns their URLs, in
  // the same order, for example "/api/uploads/3f2b...e1.png". Store the URLs
  // on your document. Files are checked again here, so a caller that skipped
  // @ImageUpload() still cannot store something else.
  async save(files: UploadedImage[]): Promise<string[]> {
    const named = files.map((file) => ({
      file,
      name: `${randomUUID()}.${assertValidImage(file)}`,
    }));
    await fs.mkdir(this.dir, { recursive: true });
    await Promise.all(
      named.map(({ file, name }) =>
        fs.writeFile(join(this.dir, name), file.buffer),
      ),
    );
    return named.map(({ name }) => UPLOADS_URL_PREFIX + name);
  }

  // Deletes a file returned by save(). Unknown or already deleted files are
  // ignored, so it is safe to call when replacing or removing an image.
  async remove(url: string): Promise<void> {
    const name = this.nameFromUrl(url);
    if (!name) return;
    await fs.unlink(join(this.dir, name)).catch((err) => {
      if (err?.code !== 'ENOENT') throw err;
    });
  }

  // Absolute path of a stored file for GET /api/uploads/:file, or 404.
  async pathOf(name: string): Promise<string> {
    if (FILE_NAME.test(name)) {
      const path = join(this.dir, name);
      const exists = await fs.stat(path).then(
        (s) => s.isFile(),
        () => false,
      );
      if (exists) return path;
    }
    throw new NotFoundException('File not found');
  }

  private nameFromUrl(url: string): string | null {
    const name = String(url ?? '')
      .split('?')[0]
      .split('/')
      .pop();
    return name && FILE_NAME.test(name) ? name : null;
  }
}
