import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as request from 'supertest';
import { configureApp } from '../app.setup';
import { MAX_IMAGE_BYTES } from './image-file';
import { UploadsModule } from './uploads.module';
import { UploadsService } from './uploads.service';

// GEN-08 over HTTP, the way Swagger sends files (multipart/form-data). Only
// UploadsModule is loaded, so the global login guard is not part of this
// test; route-guards.spec.ts checks that POST /uploads/images needs a session.
describe('UploadsController (GEN-08)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = (bytes: number) =>
    Buffer.concat([PNG, Buffer.alloc(bytes - PNG.length)]);

  let app: INestApplication;
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'uploads-http-'));
    const moduleRef = await Test.createTestingModule({
      imports: [UploadsModule],
    }).compile();
    moduleRef.get(UploadsService).dir = dir;
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const upload = () => request(app.getHttpServer()).post('/api/uploads/images');

  it('stores a 1 MB PNG and serves it at the returned URL', async () => {
    const res = await upload()
      .attach('images', png(1024 * 1024), 'photo.png')
      .expect(201);
    expect(res.body.urls).toHaveLength(1);
    const file = await request(app.getHttpServer())
      .get(res.body.urls[0])
      .expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(Buffer.from(file.body).length).toBe(1024 * 1024);
  });

  it('rejects a file larger than 5 MB with 400 in the shared format', async () => {
    const big = Buffer.concat([JPG, Buffer.alloc(MAX_IMAGE_BYTES + 1024)]);
    const res = await upload().attach('images', big, 'big.jpg').expect(400);
    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Each image must be at most 5 MB',
      path: '/api/uploads/images',
      timestamp: expect.any(String),
    });
  });

  it('rejects a GIF and a text file renamed to .png', async () => {
    await upload()
      .attach('images', Buffer.from('GIF89a......'), 'anim.gif')
      .expect(400);
    const res = await upload()
      .attach('images', Buffer.from('just some text'), 'notes.png')
      .expect(400);
    expect(res.body.message).toBe('"notes.png" must be a JPG or PNG image');
  });

  it('rejects more images than the limit', async () => {
    let req = upload();
    for (let i = 0; i < 6; i++) req = req.attach('images', PNG, `p${i}.png`);
    const res = await req.expect(400);
    expect(res.body.message).toBe(
      'Upload at most 5 images in the "images" field',
    );
  });

  // multer 2 reports this as "Unexpected file field", which Nest 10 does not
  // turn into a 400 on its own; it used to reach the client as a 500.
  it('rejects a file sent in another field with 400, not 500', async () => {
    const res = await upload().attach('photo', PNG, 'p.png').expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Upload at most 5 images in the "images" field',
    });
  });

  it('rejects a request without a file', async () => {
    const res = await upload().field('note', 'no file').expect(400);
    expect(res.body.message).toBe(
      'Upload at least one image in the "images" field',
    );
  });

  it('answers 404 for unknown files and unsafe names', async () => {
    await request(app.getHttpServer())
      .get('/api/uploads/00000000-0000-0000-0000-000000000000.png')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/uploads/..%2F.env')
      .expect(404);
  });
});
