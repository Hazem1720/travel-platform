// TEMPORARY (test branch only): Milestone 1 test plan, Part 9 (blog,
// comments, likes, reports and moderation), cases 9.1-9.17. Every case runs
// even if an earlier one fails; results are printed at the end. Where the
// spec names no status code, any refusal (4xx) passes and the code is
// recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { HotelStayCompletionJob } from '../src/hotel-bookings/hotel-stay-completion.job';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, admin, hotelModerator, traveler } from './e2e/actors';
import { seedReference } from './e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 260)}]` : '';
    throw new Error(what + got);
  }
}
const refused = (r: Res) => r.status >= 400 && r.status < 500;
async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    results.push({ id, ok: true, note: (await fn()) || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 500) });
  }
}
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const idOf = (b: any) => String(b?._id ?? b?.id);

describe('Test plan Part 9: blog, comments & reports', () => {
  let t: TestApp;
  let A: Actor, B: Actor, adm: Actor;

  beforeAll(async () => {
    t = await createTestApp('part9-blog');
    await seedReference(t);
    A = await traveler(t, 'TEST Amira');
    B = await traveler(t, 'TEST Bassem');
    adm = await admin(t);
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 9 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 9.1-9.18', async () => {
    const post = (who: Actor, body: Record<string, unknown>) => who.agent.post('/api/posts').send(body);
    let P = '', D = '';
    await tc('9.1', async () => {
      const p = await post(A, { title: 'TEST Three days in Luxor', body: 'TEST temples and the Nile', tags: ['luxor', 'history'], status: 'Published' });
      check(p.status === 201 && p.body.status === 'Published', 'published post 201', p);
      P = idOf(p.body);
      const d = await post(A, { title: 'TEST My draft', body: 'TEST not ready' });
      check(d.status === 201 && d.body.status === 'Draft', 'draft by default', d);
      D = idOf(d.body);
    });

    await tc('9.2', async () => {
      for (const [what, body] of [
        ['empty title', { title: '', body: 'x' }],
        ['empty body', { title: 'TEST', body: '' }],
        ['6 tags', { title: 'TEST', body: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }],
        ['31-character tag', { title: 'TEST', body: 'x', tags: ['x'.repeat(31)] }],
        ['bad status', { title: 'TEST', body: 'x', status: 'Live' }],
      ] as const) {
        const r = await post(A, body as any);
        check(r.status === 400, `${what} -> 400 (BLG-08)`, r);
      }
      const anon = await t.http().post('/api/posts').send({ title: 'TEST', body: 'x' });
      check(anon.status === 401, 'no session 401', anon);
    });

    await tc('9.3', async () => {
      const feed = await t.http().get('/api/posts');
      const s = JSON.stringify(feed.body);
      check(feed.status === 200 && s.includes(P) && !s.includes(D), 'feed: published only, logged out', feed);
      check(!!feed.body.meta, 'paginated', feed);
      const tag = await t.http().get('/api/tags/luxor/posts');
      check(tag.status === 200 && JSON.stringify(tag.body).includes(P), 'tag page', tag);
      const q = await t.http().get('/api/posts').query({ tag: 'history' });
      check(JSON.stringify(q.body).includes(P), 'tag filter', q);
      const sr = await t.http().get('/api/posts').query({ search: 'Luxor' });
      check(JSON.stringify(sr.body).includes(P), 'search by title (BLG-09)', sr);
      const author = await t.http().get('/api/posts').query({ search: 'Amira' });
      check(JSON.stringify(author.body).includes(P), 'search by author name', author);
      const none = await t.http().get('/api/posts').query({ search: 'zzzz-nothing' });
      check(none.status === 200 && none.body.data.length === 0, 'no results: empty list', none);
    });

    await tc('9.4', async () => {
      const r = await t.http().get(`/api/posts/${P}`);
      check(r.status === 200 && r.body.body === 'TEST temples and the Nile', 'full post logged out', r);
      check(/like/i.test(JSON.stringify(r.body)) && /comment/i.test(JSON.stringify(r.body)), 'likes and comment count', r);
      const other = await B.agent.get(`/api/posts/${D}`);
      check(other.status === 404, "someone else's draft 404", other);
      const own = await A.agent.get(`/api/posts/${D}`);
      check(own.status === 200, 'the author opens their own draft', own);
    });

    await tc('9.5', async () => {
      const r = await A.agent.get('/api/posts/mine');
      const s = JSON.stringify(r.body);
      check(r.status === 200 && s.includes(P) && s.includes(D), 'my posts incl. the draft', r);
      check(!JSON.stringify((await B.agent.get('/api/posts/mine')).body).includes(P), "not in B's list");
    });

    await tc('9.6', async () => {
      const e = await A.agent.patch(`/api/posts/${P}`).send({ title: 'TEST Three days in Luxor (updated)' });
      check(e.status === 200, 'edit own post', e);
      const other = await B.agent.patch(`/api/posts/${P}`).send({ title: 'hacked' });
      check(other.status === 404 || other.status === 403, "editing another's post refused", other);
      const img = await A.agent.post(`/api/posts/${P}/images`).attach('images', PNG, 'a.png');
      check(img.status === 201 || img.status === 200, 'image upload (BLG-10)', img);
      const url = JSON.stringify(img.body).match(/\/api\/uploads\/[\w.-]+/)?.[0] ?? '';
      const many = A.agent.post(`/api/posts/${P}/images`);
      for (let i = 0; i < 5; i++) many.attach('images', PNG, `m${i}.png`);
      const six = await many;
      check(six.status === 400, 'over 5 images 400 (GEN-08)', six);
      const di = await A.agent.delete(`/api/posts/${P}/images/${url.split('/').pop()}`);
      check(di.status === 200 || di.status === 204, 'delete image', di);
      const del = await A.agent.delete(`/api/posts/${D}`);
      check(del.status === 200 || del.status === 204, 'delete own post', del);
      check((await A.agent.get(`/api/posts/${D}`)).status === 404, 'deleted');
      const delOther = await B.agent.delete(`/api/posts/${P}`);
      check(delOther.status === 404 || delOther.status === 403, "deleting another's post refused", delOther);
      return `other edit ${other.status}, other delete ${delOther.status}`;
    });

    let IT = '';
    await tc('9.7', async () => {
      const it = await A.agent.post('/api/itineraries').send({ title: 'TEST Luxor plan', countries: ['EG'], startDate: '2099-12-10' });
      IT = idOf(it.body);
      await A.agent.patch(`/api/itineraries/${IT}`).send({ visibility: 'Public' }).expect(200);
      const r = await A.agent.patch(`/api/posts/${P}/itinerary`).send({ itineraryId: IT });
      check(r.status === 200, 'attach own public itinerary (BLG-13)', r);
      check(JSON.stringify((await t.http().get(`/api/posts/${P}`)).body).includes(IT), 'shown on the post');
      const bit = await B.agent.post('/api/itineraries').send({ title: 'TEST B private', countries: ['EG'], startDate: '2099-12-10' });
      const bad = await A.agent.patch(`/api/posts/${P}/itinerary`).send({ itineraryId: idOf(bit.body) });
      check(refused(bad), "another user's private itinerary refused", bad);
      return `refused with ${bad.status}`;
    });

    await tc('9.8', async () => {
      const r = await t.http().get(`/api/authors/${A.id}`);
      check(r.status === 200, 'author page 200 logged out', r);
      const s = JSON.stringify(r.body);
      check(s.includes('TEST Amira') && s.includes(P) && s.includes(IT), 'name, published posts and public itineraries (BLG-12)', r);
      check(/join|createdAt|memberSince/i.test(s), 'join date', r);
    });

    await tc('9.9', async () => {
      const l1 = await B.agent.post(`/api/posts/${P}/like`);
      const l2 = await B.agent.post(`/api/posts/${P}/like`);
      check([200, 201].includes(l1.status), 'like', l1);
      const count = (await t.http().get(`/api/posts/${P}`)).body;
      const likes = count.likeCount ?? count.likesCount ?? count.likes;
      check(likes === 1, `liking twice counts once (got ${likes}, second like ${l2.status})`);
      const un = await B.agent.delete(`/api/posts/${P}/like`);
      check([200, 204].includes(un.status), 'unlike', un);
      const after = (await t.http().get(`/api/posts/${P}`)).body;
      check((after.likeCount ?? after.likesCount ?? after.likes) === 0, 'back to 0');
      const anon = await t.http().post(`/api/posts/${P}/like`);
      check(anon.status === 401, 'liking needs a session', anon);
    });

    let C = '';
    await tc('9.10', async () => {
      const c1 = await B.agent.post(`/api/posts/${P}/comments`).send({ body: 'TEST first comment' });
      check(c1.status === 201, 'comment 201', c1);
      C = idOf(c1.body);
      await A.agent.post(`/api/posts/${P}/comments`).send({ body: 'TEST second comment' }).expect(201);
      const list = await t.http().get(`/api/posts/${P}/comments`);
      const s = JSON.stringify(list.body);
      check(list.status === 200 && s.indexOf('TEST first') < s.indexOf('TEST second'), 'listed oldest first (BLG-05)', list);
      const e = await B.agent.patch(`/api/comments/${C}`).send({ body: 'TEST first comment (edited)' });
      check(e.status === 200, 'edit own comment (BLG-07)', e);
      const other = await A.agent.patch(`/api/comments/${C}`).send({ body: 'hacked' });
      check(other.status === 404 || other.status === 403, "editing another's comment refused", other);
      const extra = await B.agent.post(`/api/posts/${P}/comments`).send({ body: 'TEST to delete' });
      const del = await B.agent.delete(`/api/comments/${idOf(extra.body)}`);
      check(del.status === 200 || del.status === 204, 'delete own comment', del);
      return `other edit: ${other.status}`;
    });

    await tc('9.11', async () => {
      const empty = await B.agent.post(`/api/posts/${P}/comments`).send({ body: '' });
      const long = await B.agent.post(`/api/posts/${P}/comments`).send({ body: 'x'.repeat(501) });
      check(empty.status === 400 && long.status === 400, `empty and 501 characters 400 (got ${empty.status}/${long.status})`);
      const ok = await B.agent.post(`/api/posts/${P}/comments`).send({ body: 'x'.repeat(500) });
      check(ok.status === 201, '500 characters is fine', ok);
      const d2 = await post(A, { title: 'TEST another draft', body: 'x' });
      const onDraft = await B.agent.post(`/api/posts/${idOf(d2.body)}/comments`).send({ body: 'hi' });
      check(onDraft.status === 404, 'comment on a draft 404', onDraft);
    });

    let R1 = '';
    await tc('9.12', async () => {
      const r = await A.agent.post('/api/reports').send({ targetType: 'comment', targetId: C, reason: 'TEST rude' });
      check(r.status === 201, 'report a comment 201', r);
      R1 = idOf(r.body);
      const twice = await A.agent.post('/api/reports').send({ targetType: 'comment', targetId: C, reason: 'again' });
      check(twice.status === 409, 'the same item twice 409', twice);
      const it = await B.agent.post('/api/reports').send({ targetType: 'itinerary', targetId: IT, reason: 'TEST spam' });
      check(it.status === 201, 'report an itinerary (GEN-09)', it);
      const unknown = await A.agent.post('/api/reports').send({ targetType: 'post', targetId: String(new Types.ObjectId()), reason: 'x' });
      check(unknown.status === 404, 'unknown item 404', unknown);
      const noReason = await A.agent.post('/api/reports').send({ targetType: 'post', targetId: P });
      check(noReason.status === 400, 'no reason 400', noReason);
    });

    await tc('9.13', async () => {
      const list = await adm.agent.get('/api/admin/reports');
      check(list.status === 200 && JSON.stringify(list.body).includes(R1), 'open reports listed', list);
      const content = await adm.agent.get(`/api/admin/content/comment/${C}`);
      check(content.status === 200 && JSON.stringify(content.body).includes('TEST first comment'), 'the reported content', content);
    });

    await tc('9.14', async () => {
      const r = await adm.agent.patch(`/api/admin/reports/${R1}`).send({ action: 'hide' });
      check(r.status === 200, 'hide through the report', r);
      const list = await t.http().get(`/api/posts/${P}/comments`);
      check(!JSON.stringify(list.body).includes('TEST first comment'), 'hidden from the public', list);
      // GEN-01 lists no notification for moderation, so none is expected.
      const hp = await adm.agent.patch(`/api/admin/content/post/${P}/hide`).send({ hidden: true });
      check(hp.status === 200, 'admin hides a post directly (GEN-10)', hp);
      const pub = await B.agent.get(`/api/posts/${P}`);
      const own = await A.agent.get(`/api/posts/${P}`);
      check(pub.status === 404 && own.status === 200, `hidden post: others 404, author 200 (got ${pub.status}/${own.status})`);
      await adm.agent.patch(`/api/admin/content/post/${P}/hide`).send({ hidden: false }).expect(200);
      const back = await t.http().get(`/api/posts/${P}`);
      check(back.status === 200, 'unhidden', back);
      const extra = await A.agent.post(`/api/posts/${P}/comments`).send({ body: 'TEST bad words' });
      const del = await adm.agent.delete(`/api/admin/content/comment/${idOf(extra.body)}`);
      check(del.status === 200 || del.status === 204, 'admin deletes a comment', del);
      const logs = await adm.agent.get('/api/admin/audit-logs');
      check(logs.status === 200 && /hide|delete/i.test(JSON.stringify(logs.body)), 'in the audit log (GEN-07)', logs);
    });

    await tc('9.15', async () => {
      const c2 = await B.agent.post(`/api/posts/${P}/comments`).send({ body: 'TEST harmless' });
      const rep = await A.agent.post('/api/reports').send({ targetType: 'comment', targetId: idOf(c2.body), reason: 'TEST' });
      const r = await adm.agent.patch(`/api/admin/reports/${idOf(rep.body)}`).send({ action: 'dismiss' });
      check(r.status === 200, 'dismiss', r);
      check(JSON.stringify((await t.http().get(`/api/posts/${P}/comments`)).body).includes('TEST harmless'), 'content stays');
      const open = await adm.agent.get('/api/admin/reports');
      check(!JSON.stringify(open.body).includes(idOf(rep.body)) || JSON.stringify(open.body).includes('ismiss'), 'report closed', open);
    });

    await tc('9.16', async () => {
      const routes: ['get' | 'patch' | 'delete', string][] = [
        ['get', '/api/admin/reports'],
        ['patch', `/api/admin/reports/${R1}`],
        ['get', `/api/admin/content/post/${P}`],
        ['patch', `/api/admin/content/post/${P}/hide`],
        ['delete', `/api/admin/content/post/${P}`],
      ];
      for (const [m, path] of routes) {
        const r = await (A.agent as any)[m](path).send({ action: 'dismiss', hidden: true });
        check(r.status === 403, `${m.toUpperCase()} ${path} as a user 403`, r);
      }
    });

    await tc('9.17', async () => {
      const hotel = (await adm.agent.post('/api/hotels').send({ name: 'TEST Review Hotel', address: '1 St', cityId: 'cairo', countryCode: 'EG', starClass: 3 })).body._id;
      const mod = await hotelModerator(t, hotel);
      await mod.agent.put(`/api/hotels/${hotel}/policies`).send({ checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [] });
      const room = (await mod.agent.post(`/api/hotels/${hotel}/rooms`).send({ name: '1', type: 'Double', beds: 2, maxOccupancy: 2, pricePerNight: 10000 })).body;
      await mod.agent.post(`/api/hotels/${hotel}/rooms/${idOf(room)}/availability`).send({ from: '2099-12-01', to: '2099-12-31' });
      const bk = await A.agent.post('/api/hotel-bookings').send({ hotelId: hotel, checkIn: '2099-12-10', checkOut: '2099-12-11', rooms: [{ roomId: idOf(room), adults: 1, childAges: [] }] });
      await A.agent.post(`/api/bookings/hotel/${bk.body._id}/accept-policies`).send({ accepted: true }).expect(200);
      await A.agent.post(`/api/bookings/hotel/${bk.body._id}/pay`).expect(201);
      const intent = t.stripe.lastIntent()!;
      const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
      await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);
      await t.app.get(HotelStayCompletionJob).completeStays(new Date('2099-12-12T12:00:00Z'));
      const rv = await A.agent.post(`/api/hotel-bookings/${bk.body._id}/review`).send({ rating: 1, text: 'TEST awful' });
      check(rv.status === 201, 'review 201', rv);
      check((await t.http().get(`/api/hotels/${hotel}/reviews`)).body.ratingCount === 1, 'rated');
      const rep = await B.agent.post('/api/reports').send({ targetType: 'review', targetId: idOf(rv.body), reason: 'TEST fake review' });
      check(rep.status === 201, 'report the review', rep);
      const del = await adm.agent.patch(`/api/admin/reports/${idOf(rep.body)}`).send({ action: 'delete' });
      check(del.status === 200, 'admin deletes it through the report', del);
      const page = (await t.http().get(`/api/hotels/${hotel}/reviews`)).body;
      check(page.ratingCount === 0, `hotel rating recalculated (count ${page.ratingCount})`);
    });

    await tc('9.18', async () => {
      // GEN-10 for comments: B's comment C was hidden in 9.14.
      const asAuthor = await B.agent.get(`/api/posts/${P}/comments`);
      const mine = (asAuthor.body.data ?? []).find((c: any) => c.body?.startsWith('TEST first comment'));
      check(!!mine && mine.hidden === true, "the comment's author still sees it, marked hidden", asAuthor);
      const asOther = await A.agent.get(`/api/posts/${P}/comments`);
      check(!JSON.stringify(asOther.body).includes('TEST first comment'), 'another user does not', asOther);
      const asAdmin = await adm.agent.get(`/api/posts/${P}/comments`);
      check(JSON.stringify(asAdmin.body).includes('TEST first comment'), 'an admin does', asAdmin);
      // GEN-10 for reviews.
      const hotel = (await adm.agent.post('/api/hotels').send({ name: 'TEST Hidden Review Hotel', address: '1 St', cityId: 'cairo', countryCode: 'EG', starClass: 3 })).body._id;
      const mod = await hotelModerator(t, hotel);
      await mod.agent.put(`/api/hotels/${hotel}/policies`).send({ checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [] });
      const room = (await mod.agent.post(`/api/hotels/${hotel}/rooms`).send({ name: '1', type: 'Double', beds: 2, maxOccupancy: 2, pricePerNight: 10000 })).body;
      await mod.agent.post(`/api/hotels/${hotel}/rooms/${idOf(room)}/availability`).send({ from: '2099-12-01', to: '2099-12-31' });
      const bk = await A.agent.post('/api/hotel-bookings').send({ hotelId: hotel, checkIn: '2099-12-20', checkOut: '2099-12-21', rooms: [{ roomId: idOf(room), adults: 1, childAges: [] }] });
      await A.agent.post(`/api/bookings/hotel/${bk.body._id}/accept-policies`).send({ accepted: true }).expect(200);
      await A.agent.post(`/api/bookings/hotel/${bk.body._id}/pay`).expect(201);
      const intent = t.stripe.lastIntent()!;
      const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
      await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);
      await t.app.get(HotelStayCompletionJob).completeStays(new Date('2099-12-22T12:00:00Z'));
      const rv = await A.agent.post(`/api/hotel-bookings/${bk.body._id}/review`).send({ rating: 3, text: 'TEST hidden review' });
      check(rv.status === 201, 'review', rv);
      const h = await adm.agent.patch(`/api/admin/content/review/${idOf(rv.body)}/hide`).send({ hidden: true });
      check(h.status === 200, 'admin hides the review', h);
      const pub = await t.http().get(`/api/hotels/${hotel}/reviews`);
      check(!JSON.stringify(pub.body).includes('TEST hidden review'), 'hidden from visitors', pub);
      const own = await A.agent.get(`/api/hotels/${hotel}/reviews`);
      const r = (own.body.data ?? []).find((x: any) => x.text === 'TEST hidden review');
      check(!!r && r.hidden === true, 'its author still sees it, marked hidden', own);
      const other = await B.agent.get(`/api/hotels/${hotel}/reviews`);
      check(!JSON.stringify(other.body).includes('TEST hidden review'), 'another user does not', other);
      const admView = await adm.agent.get(`/api/hotels/${hotel}/reviews`);
      check(JSON.stringify(admView.body).includes('TEST hidden review'), 'an admin does', admView);
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
