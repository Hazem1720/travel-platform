import { SchedulerRegistry } from '@nestjs/schedule';
import { readFileSync, readdirSync } from 'fs';
import { createConnection } from 'mongoose';
import { join } from 'path';
import { SeatAssignment } from '../../src/flight-bookings/schemas/seat-assignment.schema';
import { RoomLock } from '../../src/hotel-bookings/schemas/room-lock.schema';
import { traveler } from './actors';
import { collectRoutes, createTestApp, dropTestDatabase, TestApp } from './app';
import { paymentIntentEvent, signedWebhook } from './fakes';
import { HitLine } from './recorder';
import { HITS_PREFIX } from './run-dir';
import { findSensitiveKeys } from './sensitive-keys';
import { assertSafeTestUri } from './uri-guard';

// Self-test of the e2e harness (E2E_PLAN.md section 1). These tests check
// the test tooling, not a requirement, so their titles name no REQ-ID.

describe('e2e harness', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp('harness');
  });
  afterAll(async () => t?.close());

  async function databaseNames(): Promise<string[]> {
    const admin = t.conn.getClient().db().admin();
    const { databases } = await admin.listDatabases();
    return databases.map((d: { name: string }) => d.name);
  }

  describe('database isolation', () => {
    it('gives each test app its own e2e- database', async () => {
      const other = await createTestApp('harness-other');
      try {
        expect(t.dbName).toMatch(/^e2e-harness-[0-9a-f]{8}$/);
        expect(other.dbName).toMatch(/^e2e-harness-other-[0-9a-f]{8}$/);
        expect(other.dbName).not.toBe(t.dbName);
        expect(t.conn.db!.databaseName).toBe(t.dbName);
      } finally {
        await other.close();
      }
    });

    it('closing a test app drops its own database and no other', async () => {
      const other = await createTestApp('harness-drop');
      // Write something to both, so both databases exist.
      await t.conn.collection('probe').insertOne({ n: 1 });
      await other.conn.collection('probe').insertOne({ n: 1 });
      expect(await databaseNames()).toEqual(
        expect.arrayContaining([t.dbName, other.dbName]),
      );

      await other.close();

      const names = await databaseNames();
      expect(names).not.toContain(other.dbName);
      expect(names).toContain(t.dbName);
    });

    it('refuses to drop a database without the e2e- prefix and leaves it intact', async () => {
      const name = `shared-like-${Date.now()}`;
      const conn = await createConnection(process.env.E2E_MONGODB_URI!, {
        dbName: name,
      }).asPromise();
      try {
        await conn.collection('keep').insertOne({ n: 1 });
        await expect(dropTestDatabase(conn)).rejects.toThrow(
          `refusing to drop "${name}"`,
        );
        expect(await conn.collection('keep').countDocuments()).toBe(1);
      } finally {
        // Cleaned up here directly: this is the one database the harness
        // itself would refuse to drop.
        await conn.dropDatabase();
        await conn.close();
      }
    });
  });

  describe('URI guard', () => {
    const shared =
      'mongodb+srv://team:secret@cluster0.example.mongodb.net/travel';

    it('refuses a mongodb+srv (Atlas) URI unless E2E_ALLOW_ATLAS=1', () => {
      expect(() =>
        assertSafeTestUri(
          'mongodb+srv://u:p@throwaway.example.mongodb.net/e2e',
          {
            allowAtlas: false,
            sharedUri: null,
          },
        ),
      ).toThrow('refusing a mongodb+srv (Atlas) URI');
      expect(() =>
        assertSafeTestUri(
          'mongodb+srv://u:p@throwaway.example.mongodb.net/e2e',
          {
            allowAtlas: true,
            sharedUri: shared,
          },
        ),
      ).not.toThrow();
    });

    it('refuses the shared database from backend/.env, even with E2E_ALLOW_ATLAS=1', () => {
      for (const uri of [
        shared,
        // Other credentials and options, same cluster and database.
        'mongodb+srv://someone:else@CLUSTER0.example.mongodb.net/travel?retryWrites=true',
      ]) {
        expect(() =>
          assertSafeTestUri(uri, { allowAtlas: true, sharedUri: shared }),
        ).toThrow('this is the shared database');
      }
    });

    it('refuses a missing URI and never prints the URI it refuses', () => {
      expect(() =>
        assertSafeTestUri(undefined, { allowAtlas: false, sharedUri: null }),
      ).toThrow('no test database URI');
      let message = '';
      try {
        assertSafeTestUri(shared, { allowAtlas: true, sharedUri: shared });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toContain('secret');
      expect(message).not.toContain('cluster0');
    });

    it('accepts the in-memory database this run uses', () => {
      expect(process.env.E2E_MONGODB_URI).toMatch(/^mongodb:\/\//);
      expect(() =>
        assertSafeTestUri(process.env.E2E_MONGODB_URI, {
          allowAtlas: false,
          sharedUri: shared,
        }),
      ).not.toThrow();
    });
  });

  describe('indexes', () => {
    it('has built the unique room-night and seat indexes before the first test', async () => {
      const keysOf = async (model: string) =>
        (await t.model(model).collection.indexes())
          .filter((i) => i.unique)
          .map((i) => i.key);
      expect(await keysOf(RoomLock.name)).toContainEqual({
        roomId: 1,
        date: 1,
      });
      expect(await keysOf(SeatAssignment.name)).toEqual(
        expect.arrayContaining([
          { flightId: 1, cabinId: 1, seat: 1 },
          { bookingId: 1, segment: 1, passengerIndex: 1 },
        ]),
      );
    });
  });

  describe('outside world', () => {
    it('blocks every outside network call', async () => {
      await expect(fetch('https://example.com/')).rejects.toThrow();
    });

    it('stops every cron job after boot', () => {
      const jobs = [...t.app.get(SchedulerRegistry).getCronJobs().values()];
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.filter((j) => j.running)).toHaveLength(0);
    });

    it('sends emails to the outbox and registers a working traveler', async () => {
      const user = await traveler(t);
      expect(t.outbox.to(user.email).length).toBeGreaterThan(0);
      const me = await user.agent.get('/api/auth/me').expect(200);
      expect(me.body.email).toBe(user.email);
    });
  });

  describe('Stripe fake', () => {
    it('signs webhooks the real verifyEvent accepts, and a changed body fails it', async () => {
      const intent = await t.stripe.createIntent(
        { amount: 1234, currency: 'usd', metadata: { k: 'v' } },
        'idem-1',
      );
      expect(
        await t.stripe.createIntent(
          { amount: 1234, currency: 'usd', metadata: { k: 'v' } },
          'idem-1',
        ),
      ).toEqual(intent);

      const event = paymentIntentEvent(
        'payment_intent.succeeded',
        t.stripe.succeed(intent.id),
      );
      const { payload, signature } = signedWebhook(event);
      const verified = t.stripe.verifyEvent(Buffer.from(payload), signature);
      expect(verified).toMatchObject({
        type: 'payment_intent.succeeded',
        intent: { id: intent.id, amountReceived: 1234 },
      });

      const changed = payload.replace('1234', '9999');
      expect(() =>
        t.stripe.verifyEvent(Buffer.from(changed), signature),
      ).toThrow('Invalid Stripe signature');
    });

    it('the webhook route reads the raw body and refuses a missing signature', async () => {
      const { payload } = signedWebhook({ id: 'evt_x', type: 'x', data: {} });
      await t
        .http()
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(payload)
        .expect(400);
    });
  });

  describe('recorder and route list', () => {
    const hits = (): HitLine[] => {
      const dir = process.env.E2E_RUN_DIR!;
      return readdirSync(dir)
        .filter((f) => f.startsWith(HITS_PREFIX))
        .flatMap((f) =>
          readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean),
        )
        .map((l) => JSON.parse(l));
    };

    it('records the 401 that the auth guard sends, under the route template', async () => {
      await t
        .http()
        .get('/api/itineraries/000000000000000000000000')
        .expect(401);
      expect(hits()).toContainEqual({
        kind: 'hit',
        route: 'GET /api/itineraries/:id',
        status: 401,
      });
    });

    it('finds sensitive keys at any depth, by exact name', () => {
      expect(
        findSensitiveKeys({
          items: [{ owner: { name: 'x', passwordHash: 'h' } }],
          refreshedAt: 'not a secret',
          passwordChangedAt: 'not a secret',
        }),
      ).toEqual([{ key: 'passwordHash', path: 'items[0].owner.passwordHash' }]);
    });

    it('treats field names in validation errors as names, not secrets', () => {
      // The shared error format keys "details" by the field that failed.
      expect(
        findSensitiveKeys({
          statusCode: 400,
          message: 'Validation failed',
          details: { password: ['password is too short'] },
        }),
      ).toEqual([]);
      // Outside an error body the same key is a leak.
      expect(findSensitiveKeys({ details: { password: 'Passw0rd1' } })).toEqual(
        [{ key: 'password', path: 'details.password' }],
      );
    });

    it('lists every route Express serves, including aliased decorators', () => {
      const routes = collectRoutes(t.app);
      const keys = routes.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
      // blog.controller.ts registers these with an alias (HttpPost).
      expect(keys).toEqual(
        expect.arrayContaining([
          'POST /api/posts',
          'POST /api/posts/:id/images',
        ]),
      );
      expect(routes.filter((r) => !r.declared).map((r) => r.key)).toEqual([]);
      expect(
        routes.find((r) => r.key === 'POST /api/payments/webhook'),
      ).toMatchObject({
        isPublic: true,
        roles: [],
      });
      expect(
        routes.find((r) => r.key === 'POST /api/admin/moderators'),
      ).toMatchObject({
        isPublic: false,
        roles: ['admin'],
      });
    });
  });
});
