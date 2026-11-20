// Milestone 1 test plan, Part 18: editing and deleting the parts of an
// itinerary, and what happens to the things that point at a deleted one
// (a blog post it is attached to, a favourite, the public search). Each test
// builds its own data, so the order does not matter (E2E_PLAN.md).
import * as request from 'supertest';
import { createTestApp, TestApp } from '../e2e/app';
import { Actor, traveler } from '../e2e/actors';
import { seedReference } from '../e2e/fixtures';
import { SUPPORTED_CURRENCIES } from '../../src/common/constants/currencies';

const idOf = (b: any) => String(b?._id ?? b?.id ?? '');

describe('Test plan Part 18: itinerary edits and deletions', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp('plan-18-itinerary-edits');
    await seedReference(t);
    // Today's rates, so budget summaries work without the rates API.
    const rates: Record<string, number> = {};
    for (const c of SUPPORTED_CURRENCIES) rates[c] = 1;
    await t.model('ExchangeRate').create({
      date: new Date().toISOString().slice(0, 10),
      base: 'USD',
      rates,
      fetchedAt: new Date(),
    });
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  // A two-day public itinerary with a budget entry and a transport cost.
  async function trip(owner: Actor, title = 'TEST Edits trip') {
    const it = await owner.agent
      .post('/api/itineraries')
      .send({ title, countries: ['EG'], startDate: '2099-12-10' })
      .expect(201);
    const id = idOf(it.body);
    await owner.agent
      .post(`/api/itineraries/${id}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    await owner.agent
      .post(`/api/itineraries/${id}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    const full = await owner.agent.get(`/api/itineraries/${id}`).expect(200);
    const [d1, d2] = full.body.days.map(idOf);
    const budget = await owner.agent
      .post(`/api/itineraries/${id}/days/${d1}/budgets`)
      .send({ category: 'food', amount: 200, currency: 'EGP' })
      .expect(201);
    const transport = await owner.agent
      .post(`/api/itineraries/${id}/transport-costs`)
      .send({
        mode: 'train',
        fromCityId: 'cairo',
        toCityId: 'dubai',
        amount: 300,
        currency: 'EGP',
        dayId: d2,
      });
    return {
      id,
      d1,
      d2,
      budgetId: idOf(budget.body),
      transport,
      transportId: idOf(transport.body),
    };
  }
  const summary = async (who: Actor, id: string) =>
    (await who.agent.get(`/api/itineraries/${id}/budget-summary`)).body;

  it('edits a transport cost and the itinerary shows the new values (ITN-16)', async () => {
    const U = await traveler(t, 'TEST Edit Transport');
    const tr = await trip(U);
    expect(tr.transport.status).toBe(201);
    const r = await U.agent
      .patch(`/api/transport-costs/${tr.transportId}`)
      .send({ mode: 'bus', amount: 120 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mode: 'bus', amount: 120, currency: 'EGP' });
    const it = await U.agent.get(`/api/itineraries/${tr.id}`).expect(200);
    const stored = it.body.transportCosts.find(
      (x: any) => idOf(x) === tr.transportId,
    );
    expect(stored).toMatchObject({ mode: 'bus', amount: 120 });
  });

  it('refuses an invalid transport edit and keeps the old values [partial: ITN-16, GEN-13]', async () => {
    const U = await traveler(t, 'TEST Bad Transport Edit');
    const tr = await trip(U);
    const bad: string[] = [];
    for (const body of [
      { amount: -5 },
      { amount: 'ten' },
      { mode: 'rocket' },
      { currency: 'XYZ' },
      { toCityId: 'atlantis' },
      { dayId: '6a0000000000000000000001' },
    ]) {
      const r = await U.agent
        .patch(`/api/transport-costs/${tr.transportId}`)
        .send(body);
      if (r.status < 400 || r.status >= 500) {
        bad.push(`${JSON.stringify(body)} -> ${r.status}`);
      }
    }
    expect(bad).toEqual([]);
    const it = await U.agent.get(`/api/itineraries/${tr.id}`).expect(200);
    expect(
      it.body.transportCosts.find((x: any) => idOf(x) === tr.transportId),
    ).toMatchObject({ mode: 'train', amount: 300, currency: 'EGP' });
  });

  it("cannot edit or delete another user's transport cost or budget (404) [partial: ACC-11]", async () => {
    const U = await traveler(t, 'TEST Owner Parts');
    const V = await traveler(t, 'TEST Other Parts');
    const tr = await trip(U);
    const results = [
      await V.agent
        .patch(`/api/transport-costs/${tr.transportId}`)
        .send({ amount: 1 }),
      await V.agent.delete(`/api/transport-costs/${tr.transportId}`),
      await V.agent.patch(`/api/budgets/${tr.budgetId}`).send({ amount: 1 }),
      await V.agent.delete(`/api/budgets/${tr.budgetId}`),
      await V.agent.delete(`/api/itineraries/${tr.id}`),
    ];
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    const s = await summary(U, tr.id);
    expect(s.original.total).toEqual({ EGP: 500 });
  });

  it('deletes a transport cost and the budget summary drops it (ITN-16)', async () => {
    const U = await traveler(t, 'TEST Delete Transport');
    const tr = await trip(U);
    const before = await summary(U, tr.id);
    expect(before.original.byCategory.intercity_transport).toEqual({
      EGP: 300,
    });
    const r = await U.agent.delete(`/api/transport-costs/${tr.transportId}`);
    expect(r.status).toBe(200);
    const after = await summary(U, tr.id);
    expect(after.original.byCategory.intercity_transport).toEqual({});
    expect(after.original.total).toEqual({ EGP: 200 });
    const again = await U.agent.delete(
      `/api/transport-costs/${tr.transportId}`,
    );
    expect(again.status).toBe(404);
  });

  it('deletes a budget entry and the summary drops it; a second delete is 404 (ITN-14)', async () => {
    const U = await traveler(t, 'TEST Delete Budget');
    const tr = await trip(U);
    const r = await U.agent.delete(`/api/budgets/${tr.budgetId}`);
    expect(r.status).toBe(200);
    const after = await summary(U, tr.id);
    expect(after.original.byCategory.food).toEqual({});
    expect(after.original.total).toEqual({ EGP: 300 });
    expect((await U.agent.delete(`/api/budgets/${tr.budgetId}`)).status).toBe(
      404,
    );
    expect(
      (await U.agent.patch(`/api/budgets/${tr.budgetId}`).send({ amount: 5 }))
        .status,
    ).toBe(404);
  });

  it('deletes an itinerary: it is gone for the owner, the public and its own sub-routes [partial: ITN-01, ITN-20]', async () => {
    const U = await traveler(t, 'TEST Delete Trip');
    const tr = await trip(U, 'TEST Vanishing trip');
    await U.agent
      .patch(`/api/itineraries/${tr.id}`)
      .send({ visibility: 'Public' })
      .expect(200);
    const found = await request(t.server)
      .get('/api/itineraries/public/search')
      .query({ keyword: 'Vanishing' });
    expect(found.body.data.map(idOf)).toContain(tr.id);

    const del = await U.agent.delete(`/api/itineraries/${tr.id}`);
    expect(del.status).toBe(200);

    const checks = {
      own: (await U.agent.get(`/api/itineraries/${tr.id}`)).status,
      public: (await request(t.server).get(`/api/itineraries/public/${tr.id}`))
        .status,
      summary: (await U.agent.get(`/api/itineraries/${tr.id}/budget-summary`))
        .status,
      addDay: (
        await U.agent
          .post(`/api/itineraries/${tr.id}/days`)
          .send({ cityId: 'cairo' })
      ).status,
      budget: (
        await U.agent.patch(`/api/budgets/${tr.budgetId}`).send({ amount: 1 })
      ).status,
      transport: (
        await U.agent.delete(`/api/transport-costs/${tr.transportId}`)
      ).status,
      again: (await U.agent.delete(`/api/itineraries/${tr.id}`)).status,
    };
    expect(checks).toEqual({
      own: 404,
      public: 404,
      summary: 404,
      addDay: 404,
      budget: 404,
      transport: 404,
      again: 404,
    });
    const search = await request(t.server)
      .get('/api/itineraries/public/search')
      .query({ keyword: 'Vanishing' });
    expect(search.body.data.map(idOf)).not.toContain(tr.id);
    const mine = await U.agent.get('/api/itineraries').expect(200);
    expect(mine.body.data.map(idOf)).not.toContain(tr.id);
  });

  it('a blog post whose attached itinerary is deleted still opens, without the itinerary [partial: BLG-13]', async () => {
    const U = await traveler(t, 'TEST Post Owner');
    const tr = await trip(U, 'TEST Attached trip');
    await U.agent
      .patch(`/api/itineraries/${tr.id}`)
      .send({ visibility: 'Public' })
      .expect(200);
    const post = await U.agent
      .post('/api/posts')
      .send({
        title: 'TEST Story with a trip',
        body: 'TEST body',
        tags: ['story'],
        status: 'Published',
      })
      .expect(201);
    const attach = await U.agent
      .patch(`/api/posts/${idOf(post.body)}/itinerary`)
      .send({ itineraryId: tr.id });
    expect(attach.status).toBe(200);

    await U.agent.delete(`/api/itineraries/${tr.id}`).expect(200);

    const asVisitor = await request(t.server).get(
      `/api/posts/${idOf(post.body)}`,
    );
    expect(asVisitor.status).toBe(200);
    expect(JSON.stringify(asVisitor.body)).not.toContain('TEST Attached trip');
    const list = await request(t.server).get('/api/posts');
    expect(list.status).toBe(200);
    const mine = await U.agent.get('/api/posts/mine');
    expect(mine.status).toBe(200);
  });

  it("a favourite of a deleted itinerary does not break the owner's favourites list [partial: BON-02]", async () => {
    const U = await traveler(t, 'TEST Fav Owner');
    const V = await traveler(t, 'TEST Fav Fan');
    const tr = await trip(U, 'TEST Favourite trip');
    await U.agent
      .patch(`/api/itineraries/${tr.id}`)
      .send({ visibility: 'Public' })
      .expect(200);
    const fav = await V.agent
      .post('/api/favourites')
      .send({ type: 'itinerary', id: tr.id });
    expect(fav.status).toBe(201);

    await U.agent.delete(`/api/itineraries/${tr.id}`).expect(200);

    const list = await V.agent.get('/api/favourites');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('TEST Favourite trip');
    const again = await V.agent
      .post('/api/favourites')
      .send({ type: 'itinerary', id: tr.id });
    expect(again.status).toBe(404);
  });

  it('two deletes of the same itinerary at the same moment: one 200, one 404, nothing else', async () => {
    const U = await traveler(t, 'TEST Double Delete');
    const tr = await trip(U);
    const res = await Promise.all([
      U.agent.delete(`/api/itineraries/${tr.id}`),
      U.agent.delete(`/api/itineraries/${tr.id}`),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 404]);
  });

  it('two budget entries added at the same moment are both kept [partial: ITN-14]', async () => {
    const U = await traveler(t, 'TEST Parallel Budgets');
    const tr = await trip(U);
    const res = await Promise.all(
      [10, 20, 30, 40, 50].map((amount) =>
        U.agent
          .post(`/api/itineraries/${tr.id}/days/${tr.d2}/budgets`)
          .send({ category: 'activities', amount, currency: 'EGP' }),
      ),
    );
    expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const s = await summary(U, tr.id);
    expect(s.original.byCategory.activities).toEqual({ EGP: 150 });
  });
});
