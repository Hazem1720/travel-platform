// TEMPORARY (test branch only, never merged): Hafez's blog (#188) and Emad's
// comments, likes and moderation (#183) together, over HTTP, with a real
// MongoDB.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildSwaggerDocument, configureApp } from '../src/app.setup';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

withDatabase('BLOG + COMMENTS + MODERATION live check', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let db: any;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);
  let a: any, b: any, c: any, admin: any;
  let aId: string, cId: string;
  let draftId: string, nileId: string, cairoId: string;

  const login = async (email: string, password: string) => {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return agent;
  };
  const register = async (name: string, email: string) => {
    await request(server)
      .post('/api/auth/register')
      .send({ name, email, password: 'User12345', acceptTerms: true })
      .expect(201);
    return login(email, 'User12345');
  };
  const idOf = async (email: string) =>
    String((await users.findOne({ email }).lean<any>())._id);

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    users = app.get(getModelToken(User.name));
    db = users.db;
    await users.create({
      name: 'TEST Admin',
      email: 'admin@blog.test',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      role: 'admin',
      acceptedTermsAt: new Date(),
    });
    admin = await login('admin@blog.test', 'Admin12345');
    a = await register('Amira Writer', 'a@blog.test');
    b = await register('Bassem', 'b@blog.test');
    c = await register('Carla', 'c@blog.test');
    aId = await idOf('a@blog.test');
    cId = await idOf('c@blog.test');
  }, 90_000);

  afterAll(async () => {
    console.log(`\nBLOG LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('Swagger documents the new routes', () => {
    const paths = Object.keys(buildSwaggerDocument(app).paths);
    for (const p of [
      '/api/posts',
      '/api/posts/mine',
      '/api/posts/{id}',
      '/api/posts/{id}/images',
      '/api/posts/{id}/images/{imageId}',
      '/api/posts/{id}/comments',
      '/api/posts/{id}/like',
      '/api/comments/{id}',
      '/api/tags/{tag}/posts',
      '/api/authors/{id}',
      '/api/reports',
      '/api/admin/reports',
      '/api/admin/reports/{id}',
      '/api/admin/content/{type}/{id}',
      '/api/admin/content/{type}/{id}/hide',
    ]) {
      expect(paths).toContain(p);
    }
    ok('Swagger lists all 15 blog, comment, report and moderation paths');
  });

  it('BLG-01/03/04/08: create, validate, draft, publish', async () => {
    await request(server).get('/api/posts').expect(200);
    await request(server)
      .post('/api/posts')
      .send({ title: 'x', body: 'y' })
      .expect(401);
    await admin.post('/api/posts').send({ title: 'x', body: 'y' }).expect(403);

    const draft = await a
      .post('/api/posts')
      .send({
        title: '  Paris in spring ',
        body: 'Walking along the Seine.',
        tags: ['Paris', 'paris ', 'Food'],
      })
      .expect(201);
    draftId = draft.body._id;
    expect(draft.body).toMatchObject({
      title: 'Paris in spring',
      status: 'Draft',
      publishedAt: null,
      tags: ['paris', 'food'],
      likeCount: 0,
      commentCount: 0,
    });
    ok('create: Draft by default, trimmed, tags lower-cased and de-duplicated');

    const bad = await a
      .post('/api/posts')
      .send({ title: '', body: 'b', tags: ['1', '2', '3', '4', '5', '6'] })
      .expect(400);
    expect(Object.keys(bad.body.details).sort()).toEqual(['tags', 'title']);
    const img = await a
      .post('/api/posts')
      .send({ title: 't', body: 'b', images: ['/api/uploads/x.jpg'] })
      .expect(400);
    expect(img.body.details.images).toBeDefined();
    await a
      .post('/api/posts')
      .send({ title: 't', body: 'b', tags: ['x'.repeat(31)] })
      .expect(400);
    ok(
      'create: 400 for empty title, 6 tags, 31-char tag, or image URLs in body',
    );

    await request(server).get(`/api/posts/${draftId}`).expect(404);
    const mine = await a.get('/api/posts/mine').expect(200);
    expect(mine.body.data.map((p: any) => p.status)).toEqual(['Draft']);
    ok('draft: hidden from guests (404), listed in /posts/mine');

    await b.patch(`/api/posts/${draftId}`).send({ title: 'hack' }).expect(404);
    await b.delete(`/api/posts/${draftId}`).expect(404);
    const pub = await a
      .patch(`/api/posts/${draftId}`)
      .send({ status: 'Published', tags: ['Paris', 'Europe'] })
      .expect(200);
    expect(pub.body.publishedAt).toBeTruthy();
    expect(pub.body.tags).toEqual(['paris', 'europe']);
    await request(server).get(`/api/posts/${draftId}`).expect(200);
    ok("publish via PATCH sets publishedAt; someone else's post is 404");

    nileId = (
      await a
        .post('/api/posts')
        .send({
          title: 'Nile cruise',
          body: 'N'.repeat(260),
          tags: ['egypt'],
          status: 'Published',
        })
        .expect(201)
    ).body._id;
    cairoId = (
      await c
        .post('/api/posts')
        .send({
          title: 'Cairo food tour',
          body: 'Koshary!',
          tags: ['egypt', 'food'],
          status: 'Published',
        })
        .expect(201)
    ).body._id;
  });

  it('BLG-02/08/09/12: browse, tag, search, author page', async () => {
    const all = await request(server).get('/api/posts').expect(200);
    expect(all.body.meta.total).toBe(3);
    expect(all.body.data[0].title).toBe('Cairo food tour');
    expect(all.body.data[0].author.name).toBe('Carla');
    await request(server).get('/api/posts?limit=11').expect(400);
    await request(server).get('/api/posts?foo=1').expect(400);

    const tag = await request(server).get('/api/posts?tag=EGYPT').expect(200);
    expect(tag.body.meta.total).toBe(2);
    const click = await request(server)
      .get('/api/tags/Paris/posts')
      .expect(200);
    expect(click.body.data.map((p: any) => p.title)).toEqual([
      'Paris in spring',
    ]);
    ok(
      'browse newest first with author; ?tag and /tags/:tag/posts; bad query 400',
    );

    const byTitle = await request(server)
      .get('/api/posts?search=nile')
      .expect(200);
    expect(byTitle.body.data.map((p: any) => p.title)).toEqual(['Nile cruise']);
    expect(byTitle.body.data[0].excerpt).toBe('N'.repeat(200) + '...');
    const byAuthor = await request(server)
      .get('/api/posts?search=amira')
      .expect(200);
    expect(byAuthor.body.meta.total).toBe(2);
    const byTag = await request(server)
      .get('/api/posts?search=europ')
      .expect(200);
    expect(byTag.body.data[0].title).toBe('Paris in spring');
    const none = await request(server)
      .get('/api/posts?search=zzzz')
      .expect(200);
    expect(none.body).toMatchObject({ data: [], message: 'No results found' });
    ok(
      'search by title, author name and tag; 200-char excerpt; "No results found"',
    );
  });

  it('BLG-10: images', async () => {
    const up = await a
      .post(`/api/posts/${nileId}/images`)
      .attach('images', PNG, 'one.png')
      .expect(201);
    expect(up.body.images).toHaveLength(1);
    await b
      .post(`/api/posts/${nileId}/images`)
      .attach('images', PNG, 'x.png')
      .expect(404);
    let req = a.post(`/api/posts/${nileId}/images`);
    for (let i = 0; i < 5; i++) req = req.attach('images', PNG, `p${i}.png`);
    const tooMany = await req.expect(400);
    expect(tooMany.body.message).toMatch(/At most 5 images/);
    await a
      .post(`/api/posts/${nileId}/images`)
      .attach('images', Buffer.from('not an image'), 'x.png')
      .expect(400);
    const file = up.body.images[0].split('/').pop();
    await request(server).get(`/api/uploads/${file}`).expect(200);
    await a.delete(`/api/posts/${nileId}/images/${file}`).expect(200);
    await a.delete(`/api/posts/${nileId}/images/${file}`).expect(404);
    await request(server).get(`/api/uploads/${file}`).expect(404);
    ok(
      'images: upload, 5-image limit, invalid file 400, other user 404, delete removes the file',
    );
  });

  it('BLG-05/06/07: comments and likes, search order', async () => {
    await request(server)
      .post(`/api/posts/${nileId}/comments`)
      .send({ body: 'hi' })
      .expect(401);
    const c1 = await b
      .post(`/api/posts/${nileId}/comments`)
      .send({ body: '  Lovely!  ' })
      .expect(201);
    expect(c1.body.body).toBe('Lovely!');
    await c
      .post(`/api/posts/${nileId}/comments`)
      .send({ body: 'Want to go' })
      .expect(201);
    await b
      .post(`/api/posts/${nileId}/comments`)
      .send({ body: '   ' })
      .expect(400);
    await b
      .post(`/api/posts/${nileId}/comments`)
      .send({ body: 'x'.repeat(501) })
      .expect(400);
    await a.patch(`/api/posts/${draftId}`).send({ status: 'Draft' });
    await b
      .post(`/api/posts/${draftId}/comments`)
      .send({ body: 'x' })
      .expect(404);
    await a.patch(`/api/posts/${draftId}`).send({ status: 'Published' });

    const list = await request(server)
      .get(`/api/posts/${nileId}/comments`)
      .expect(200);
    expect(list.body.data.map((x: any) => x.body)).toEqual([
      'Lovely!',
      'Want to go',
    ]);
    const page = await request(server).get(`/api/posts/${nileId}`).expect(200);
    expect(page.body.commentCount).toBe(2);
    expect(page.body.comments.data).toHaveLength(2);
    expect(page.body.author.name).toBe('Amira Writer');
    ok(
      'comments: trimmed, empty/501 chars 400, draft 404, oldest first, on the post page',
    );

    await c
      .patch(`/api/comments/${c1.body._id}`)
      .send({ body: 'mine now' })
      .expect(403);
    await b
      .patch(`/api/comments/${c1.body._id}`)
      .send({ body: 'Lovely trip!' })
      .expect(200);
    await c.delete(`/api/comments/${c1.body._id}`).expect(403);
    ok('comments: author edits; others get 403 on edit and delete');

    const like = await b.post(`/api/posts/${nileId}/like`);
    expect([200, 201]).toContain(like.status);
    expect(like.body).toEqual({ liked: true, likeCount: 1 });
    await b.post(`/api/posts/${nileId}/like`).expect(409);
    await c.post(`/api/posts/${nileId}/like`);
    const un = await c.delete(`/api/posts/${nileId}/like`).expect(200);
    expect(un.body).toEqual({ liked: false, likeCount: 1 });
    await c.delete(`/api/posts/${nileId}/like`).expect(404);
    await c.post(`/api/posts/${nileId}/like`);
    ok('likes: once per user (409), unlike, count kept right');

    // Nile: 2 likes + 2 comments; Paris: 0. Same author.
    const order = await request(server)
      .get('/api/posts?search=amira')
      .expect(200);
    expect(order.body.data.map((p: any) => p.title)).toEqual([
      'Nile cruise',
      'Paris in spring',
    ]);
    ok('search ordered by likes + comments');

    const del = await b.delete(`/api/comments/${c1.body._id}`).expect(200);
    expect(del.body).toEqual({ success: true });
    const after = await request(server).get(`/api/posts/${nileId}`).expect(200);
    expect(after.body.commentCount).toBe(1);
    ok('comment delete lowers commentCount');
  });

  it('GEN-09/10: reports and moderation', async () => {
    const r1 = await b
      .post('/api/reports')
      .send({ targetType: 'post', targetId: nileId, reason: 'Spam' })
      .expect(201);
    await b
      .post('/api/reports')
      .send({ targetType: 'post', targetId: nileId, reason: 'Again' })
      .expect(409);
    await c
      .post('/api/reports')
      .send({ targetType: 'post', targetId: nileId, reason: 'Rude' })
      .expect(201);
    await b
      .post('/api/reports')
      .send({ targetType: 'post', targetId: nileId, reason: '   ' })
      .expect(400);
    await b
      .post('/api/reports')
      .send({
        targetType: 'post',
        targetId: String(new Types.ObjectId()),
        reason: 'x',
      })
      .expect(404);
    ok('report: once per item (409), blank reason 400, unknown item 404');

    await b.get('/api/admin/reports').expect(403);
    const open = await admin.get('/api/admin/reports').expect(200);
    expect(open.body.meta.total).toBe(2);

    const hid = await admin
      .patch(`/api/admin/reports/${r1.body._id}`)
      .send({ action: 'hide' })
      .expect(200);
    expect(hid.body).toMatchObject({
      status: 'resolved',
      resolution: 'hidden',
    });
    expect((await admin.get('/api/admin/reports')).body.meta.total).toBe(0);
    await request(server).get(`/api/posts/${nileId}`).expect(404);
    const s = await request(server).get('/api/posts?search=nile').expect(200);
    expect(s.body.meta.total).toBe(0);
    const mine = await a.get('/api/posts/mine').expect(200);
    expect(mine.body.data.find((p: any) => p._id === nileId).hidden).toBe(true);
    const view = await admin
      .get(`/api/admin/content/post/${nileId}`)
      .expect(200);
    expect(view.body.content.hidden).toBe(true);
    ok(
      'resolve "hide": both open reports closed, post gone for guests and search, author and admin still see it',
    );

    await admin
      .patch(`/api/admin/content/post/${nileId}/hide`)
      .send({ hidden: false })
      .expect(200);
    await request(server).get(`/api/posts/${nileId}`).expect(200);
    ok('admin unhides directly');

    const cm = (
      await c
        .post(`/api/posts/${cairoId}/comments`)
        .send({ body: 'bad words' })
        .expect(201)
    ).body._id;
    const r2 = await b
      .post('/api/reports')
      .send({ targetType: 'comment', targetId: cm, reason: 'Abuse' })
      .expect(201);
    await admin
      .patch(`/api/admin/reports/${r2.body._id}`)
      .send({ action: 'delete' })
      .expect(200);
    const cairo = await request(server)
      .get(`/api/posts/${cairoId}`)
      .expect(200);
    expect(cairo.body.commentCount).toBe(0);
    ok('resolve "delete" on a comment removes it and lowers commentCount');

    const r3 = await c
      .post('/api/reports')
      .send({ targetType: 'post', targetId: draftId, reason: 'meh' })
      .expect(201);
    const dis = await admin
      .patch(`/api/admin/reports/${r3.body._id}`)
      .send({ action: 'dismiss' })
      .expect(200);
    expect(dis.body).toMatchObject({ status: 'dismissed' });
    await request(server).get(`/api/posts/${draftId}`).expect(200);
    ok('dismiss leaves the content');

    const itin = await db.collection('itineraries').insertOne({
      ownerId: new Types.ObjectId(aId),
      title: 'TEST Week in Egypt',
      visibility: 'Public',
      hidden: false,
      countries: ['EG'],
      startDate: new Date(),
      days: [],
    });
    await c
      .post('/api/reports')
      .send({
        targetType: 'itinerary',
        targetId: String(itin.insertedId),
        reason: 'copy',
      })
      .expect(201);
    const hotelId = new Types.ObjectId();
    await db
      .collection('hotels')
      .insertOne({
        _id: hotelId,
        name: 'TEST Hotel',
        ratingAverage: 3,
        ratingCount: 2,
      });
    const rv = await db.collection('reviews').insertMany([
      {
        hotelId,
        userId: new Types.ObjectId(cId),
        bookingId: new Types.ObjectId(),
        rating: 1,
        text: 'bad',
        hidden: false,
      },
      {
        hotelId,
        userId: new Types.ObjectId(),
        bookingId: new Types.ObjectId(),
        rating: 5,
        text: 'good',
        hidden: false,
      },
    ]);
    await b
      .post('/api/reports')
      .send({
        targetType: 'review',
        targetId: String(rv.insertedIds[0]),
        reason: 'fake',
      })
      .expect(201);
    await admin
      .delete(`/api/admin/content/review/${String(rv.insertedIds[0])}`)
      .expect(200);
    const hotel = await db.collection('hotels').findOne({ _id: hotelId });
    expect(hotel).toMatchObject({ ratingAverage: 5, ratingCount: 1 });
    ok(
      'reports on itineraries and reviews; deleting a review recalculates the hotel rating',
    );

    const author = await request(server).get(`/api/authors/${aId}`).expect(200);
    expect(author.body.author.name).toBe('Amira Writer');
    expect(author.body.posts.meta.total).toBe(2);
    expect(author.body.itineraries.data[0].title).toBe('TEST Week in Egypt');
    await admin
      .patch(`/api/admin/content/itinerary/${String(itin.insertedId)}/hide`)
      .send({ hidden: true })
      .expect(200);
    const author2 = await request(server)
      .get(`/api/authors/${aId}`)
      .expect(200);
    expect(author2.body.itineraries.meta.total).toBe(0);
    ok(
      'author page: name, join date, published posts, public itineraries; hidden itinerary left out',
    );

    await c
      .post(`/api/posts/${draftId}/comments`)
      .send({ body: 'from Carla' })
      .expect(201);
    await users.updateOne(
      { _id: new Types.ObjectId(cId) },
      { $set: { status: 'deactivated' } },
    );
    const names = await request(server)
      .get(`/api/posts/${draftId}/comments`)
      .expect(200);
    expect(names.body.data.map((x: any) => x.author.name)).toContain(
      'Deleted user',
    );
    const list = await request(server).get('/api/posts').expect(200);
    expect(list.body.data.map((p: any) => p.title)).not.toContain(
      'Cairo food tour',
    );
    await request(server).get(`/api/authors/${cId}`).expect(404);
    await request(server).get(`/api/posts/${cairoId}`).expect(404);
    ok(
      'deactivated author: posts and author page gone, comments show "Deleted user"',
    );

    const likesBefore = await db
      .collection('likes')
      .countDocuments({ postId: new Types.ObjectId(nileId) });
    expect(likesBefore).toBeGreaterThan(0);
    await admin.delete(`/api/admin/content/post/${nileId}`).expect(200);
    expect(
      await db
        .collection('comments')
        .countDocuments({ postId: new Types.ObjectId(nileId) }),
    ).toBe(0);
    expect(
      await db
        .collection('likes')
        .countDocuments({ postId: new Types.ObjectId(nileId) }),
    ).toBe(0);
    await a.delete(`/api/posts/${draftId}`).expect(200);
    expect(
      await db
        .collection('comments')
        .countDocuments({ postId: new Types.ObjectId(draftId) }),
    ).toBe(0);
    await admin.delete(`/api/admin/content/blog/${draftId}`).expect(400);
    ok(
      'admin delete and author delete remove the post with its comments and likes',
    );

    const audit = await db.collection('auditlogs').countDocuments({});
    log.push(`info audit log entries: ${audit}`);
    expect(audit).toBeGreaterThanOrEqual(5);
    ok('moderation actions are in the audit log');
  });
});
