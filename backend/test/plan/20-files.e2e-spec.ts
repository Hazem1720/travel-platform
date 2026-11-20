// Milestone 1 test plan, Part 20: uploaded images end to end. A stored file
// is served back byte for byte with a safe content type, removing an image
// (or what owns it) removes the file, and uploads at the same moment never
// pass the limit or leave stray files. Each test builds its own data, so the
// order does not matter (E2E_PLAN.md).
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as request from 'supertest';
import { UploadsService } from '../../src/uploads/uploads.service';
import { createTestApp, TestApp } from '../e2e/app';
import { Actor, traveler } from '../e2e/actors';
import { seedReference } from '../e2e/fixtures';

// A 1x1 PNG and a minimal JPEG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const idOf = (b: any) => String(b?._id ?? b?.id ?? '');

describe('Test plan Part 20: uploaded files', () => {
  let t: TestApp;
  const get = (url: string) =>
    request(t.server)
      .get(url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    t = await createTestApp('plan-20-files');
    await seedReference(t);
    // A private uploads folder: the other suites run in parallel and share
    // ./uploads, which would make the file counts below unreliable.
    (t.app.get(UploadsService) as any).dir = await fs.mkdtemp(
      join(tmpdir(), 'plan-20-uploads-'),
    );
  }, 60_000);

  afterAll(async () => {
    const dir = t && ((t.app.get(UploadsService) as any).dir as string);
    if (dir?.includes('plan-20-uploads-')) {
      await fs.rm(dir, { recursive: true, force: true });
    }
    await t?.close();
  });

  async function activity(owner: Actor) {
    const it = await owner.agent
      .post('/api/itineraries')
      .send({
        title: 'TEST Files trip',
        countries: ['EG'],
        startDate: '2099-12-10',
      })
      .expect(201);
    await owner.agent
      .post(`/api/itineraries/${idOf(it.body)}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    const full = await owner.agent
      .get(`/api/itineraries/${idOf(it.body)}`)
      .expect(200);
    const dayId = idOf(full.body.days[0]);
    const a = await owner.agent
      .post(`/api/itineraries/${idOf(it.body)}/days/${dayId}/activities`)
      .send({
        name: 'TEST Museum',
        time: '10:00',
        cost: { amount: 500, currency: 'EGP' },
      })
      .expect(201);
    return idOf(a.body);
  }

  it('serves an uploaded PNG and JPEG back byte for byte with an image type and nosniff [partial: GEN-08]', async () => {
    const U = await traveler(t, 'TEST Uploader');
    const up = await U.agent
      .post('/api/uploads/images')
      .attach('images', PNG, 'a.png')
      .attach('images', JPG, 'b.jpg');
    expect(up.status).toBe(201);
    const [pngUrl, jpgUrl] = up.body.urls as string[];
    expect(pngUrl).toMatch(/^\/api\/uploads\/[0-9a-f-]+\.png$/);
    expect(jpgUrl).toMatch(/^\/api\/uploads\/[0-9a-f-]+\.(jpg|jpeg)$/);

    const p = await get(pngUrl);
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toMatch(/^image\/png/);
    expect(p.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(p.body, PNG)).toBe(0);

    const j = await get(jpgUrl);
    expect(j.status).toBe(200);
    expect(j.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(Buffer.compare(j.body, JPG)).toBe(0);
  });

  it('answers 404 for a file that was never stored, whatever its name looks like', async () => {
    const names = [
      '00000000-0000-0000-0000-000000000000.png',
      'notes.txt',
      'a'.repeat(300) + '.png',
      '.png',
    ];
    const codes = [];
    for (const n of names) codes.push((await get(`/api/uploads/${n}`)).status);
    expect(codes).toEqual([404, 404, 404, 404]);
  });

  it('removing an activity image deletes its file but keeps the other one [partial: ITN-12]', async () => {
    const U = await traveler(t, 'TEST Activity Images');
    const aid = await activity(U);
    const up = await U.agent
      .post(`/api/activities/${aid}/images`)
      .attach('images', PNG, 'one.png')
      .attach('images', PNG, 'two.png');
    expect(up.status).toBe(201);
    const [keep, drop] = up.body.images as string[];
    expect((await get(drop)).status).toBe(200);

    const file = drop.split('/').pop();
    const del = await U.agent.delete(`/api/activities/${aid}/images/${file}`);
    expect(del.status).toBe(200);
    expect(del.body.images).toEqual([keep]);
    expect((await get(drop)).status).toBe(404);
    expect((await get(keep)).status).toBe(200);
  });

  it('deleting an activity deletes its image files [partial: ITN-10, ITN-12]', async () => {
    const U = await traveler(t, 'TEST Activity Delete');
    const aid = await activity(U);
    const up = await U.agent
      .post(`/api/activities/${aid}/images`)
      .attach('images', PNG, 'x.png');
    const [url] = up.body.images as string[];
    await U.agent.delete(`/api/activities/${aid}`).expect(200);
    expect((await get(url)).status).toBe(404);
  });

  it("another user cannot remove someone's activity image, and the file stays [partial: ACC-11, ITN-12]", async () => {
    const U = await traveler(t, 'TEST Image Owner');
    const V = await traveler(t, 'TEST Image Stranger');
    const aid = await activity(U);
    const up = await U.agent
      .post(`/api/activities/${aid}/images`)
      .attach('images', PNG, 'mine.png');
    const [url] = up.body.images as string[];
    const r = await V.agent.delete(
      `/api/activities/${aid}/images/${url.split('/').pop()}`,
    );
    expect(r.status).toBe(404);
    expect((await get(url)).status).toBe(200);
  });

  it('deleting a post deletes its image files [partial: BLG-04, BLG-10]', async () => {
    const U = await traveler(t, 'TEST Post Images');
    const post = await U.agent
      .post('/api/posts')
      .send({
        title: 'TEST Pictures',
        body: 'TEST body',
        tags: ['pics'],
        status: 'Published',
      })
      .expect(201);
    const up = await U.agent
      .post(`/api/posts/${idOf(post.body)}/images`)
      .attach('images', PNG, 'p.png');
    expect(up.status).toBe(201);
    const [url] = up.body.images as string[];
    expect((await get(url)).status).toBe(200);
    await U.agent.delete(`/api/posts/${idOf(post.body)}`).expect(200);
    expect((await get(url)).status).toBe(404);
  });

  it('six uploads of two images at the same moment never pass the 5-image limit or leave stray files [partial: BLG-10, GEN-08]', async () => {
    const U = await traveler(t, 'TEST Upload Race');
    const post = await U.agent
      .post('/api/posts')
      .send({
        title: 'TEST Race pics',
        body: 'TEST body',
        tags: ['race'],
        status: 'Published',
      })
      .expect(201);
    const pid = idOf(post.body);
    const dir = (t.app.get(UploadsService) as any).dir as string;
    const filesIn = async () =>
      (await fs.readdir(dir).catch(() => [] as string[])).length;
    const before = await filesIn();
    const res = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        U.agent
          .post(`/api/posts/${pid}/images`)
          .attach('images', PNG, `r${i}a.png`)
          .attach('images', PNG, `r${i}b.png`),
      ),
    );
    expect(res.every((r) => r.status === 201 || r.status === 400)).toBe(true);
    const stored = (await U.agent.get(`/api/posts/${pid}`)).body
      .images as string[];
    expect(stored.length).toBeLessThanOrEqual(5);
    // Every accepted upload's files are on the post; refused ones are gone.
    const accepted = res.filter((r) => r.status === 201).length;
    expect(stored.length).toBe(accepted * 2);
    const served = await Promise.all(stored.map((u) => get(u)));
    expect(served.every((s) => s.status === 200)).toBe(true);
    // Refused uploads removed their files: only the stored ones were added.
    expect((await filesIn()) - before).toBe(stored.length);
  });
});
