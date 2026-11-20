import { SchedulerRegistry } from '@nestjs/schedule';
import * as express from 'express';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { createConnection } from 'mongoose';
import { tmpdir } from 'os';
import { join } from 'path';
import * as request from 'supertest';
import { SeatAssignment } from '../../src/flight-bookings/schemas/seat-assignment.schema';
import { RoomLock } from '../../src/hotel-bookings/schemas/room-lock.schema';
import { traveler } from './actors';
import { collectRoutes, createTestApp, dropTestDatabase, TestApp } from './app';
import { paymentIntentEvent, signedWebhook } from './fakes';
import { checkCoverage } from './check-coverage';
import { HitLine, recorder } from './recorder';
import { HITS_PREFIX } from './run-dir';
import { findSensitiveKeys, isValidationErrorBody } from './sensitive-keys';
import { assertSafeTestUri, UriGuardOptions } from './uri-guard';

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
    // The shared database in the standard (non-srv) Atlas form, like the one
    // in backend/.env: three hosts on mongodb.net.
    const shared =
      'mongodb://team:secret@ac-shard-00-00.abc12.mongodb.net:27017,' +
      'ac-shard-00-01.abc12.mongodb.net:27017,' +
      'ac-shard-00-02.abc12.mongodb.net:27017/travel?ssl=true&authSource=admin';
    const sameClusterOtherDb = shared.replace('/travel?', '/e2e_other?');
    const refusedRemote = 'refusing a database that is not on';
    const noFlag = { allowAtlas: false, sharedUri: shared };
    const withFlag = { allowAtlas: true, sharedUri: shared };

    // What the guard says about a URI, in one word, so a table of cases is
    // checked in one assertion that lists every mismatch with its URI.
    const verdict = (uri: string, options: UriGuardOptions) => {
      try {
        assertSafeTestUri(uri, options);
        return 'accepted';
      } catch (err) {
        const m = (err as Error).message;
        if (m.includes('shared cluster')) return 'shared cluster';
        if (m.includes(refusedRemote)) return 'not local';
        return m;
      }
    };
    const verdicts = (uris: string[], options: UriGuardOptions) =>
      uris.map((uri) => `${uri}: ${verdict(uri, options)}`);
    const all = (uris: string[], word: string) =>
      uris.map((uri) => `${uri}: ${word}`);

    it('accepts only 127.0.0.1 and localhost without E2E_ALLOW_ATLAS=1', () => {
      const local = [
        'mongodb://127.0.0.1:27017/e2e',
        'mongodb://localhost:27017/e2e',
        'mongodb://LOCALHOST/e2e',
        'mongodb://127.0.0.1:27017,localhost:27018/e2e?replicaSet=rs0',
      ];
      const remote = [
        // A separate Atlas cluster, in both forms.
        'mongodb+srv://u:p@throwaway.zz999.mongodb.net/e2e',
        'mongodb://ac-t-00-00.zz999.mongodb.net:27017/e2e?ssl=true',
        'mongodb://10.0.0.5:27017/e2e',
        'mongodb://db.internal:27017/e2e',
        'mongodb://[::1]:27017/e2e',
        // One local host is not enough: every host must be local.
        'mongodb://127.0.0.1:27017,db.internal:27017/e2e',
        // "localhost" inside another name is not localhost.
        'mongodb://localhost.attacker.example:27017/e2e',
        // A mongodb+srv name is never local, even if it says localhost.
        'mongodb+srv://localhost/e2e',
      ];
      expect(verdicts([...local, ...remote], noFlag)).toEqual([
        ...all(local, 'accepted'),
        ...all(remote, 'not local'),
      ]);
    });

    it('with E2E_ALLOW_ATLAS=1, accepts a separate throwaway cluster', () => {
      const separate = [
        'mongodb+srv://u:p@throwaway.zz999.mongodb.net/e2e',
        'mongodb://ac-t-00-00.zz999.mongodb.net:27017/e2e?ssl=true',
        'mongodb://10.0.0.5:27017/e2e',
      ];
      expect(verdicts(separate, withFlag)).toEqual(all(separate, 'accepted'));
    });

    it('refuses every host of the backend/.env cluster, whatever the database, even with E2E_ALLOW_ATLAS=1', () => {
      const sameCluster = [
        // The .env database itself.
        shared,
        // Another database name on the same cluster.
        sameClusterOtherDb,
        // No database name at all.
        shared.replace('/travel?', '/?'),
        // Other credentials, options, host order and case.
        'mongodb://someone:else@AC-SHARD-00-02.abc12.mongodb.net:27017,' +
          'ac-shard-00-00.abc12.mongodb.net:27017,' +
          'ac-shard-00-01.abc12.mongodb.net:27017/other?retryWrites=true',
        // Just one of its hosts, with the default port written out or left out.
        'mongodb://ac-shard-00-01.abc12.mongodb.net:27017/e2e',
        'mongodb://ac-shard-00-01.abc12.mongodb.net/e2e',
        // The mongodb+srv form of the same cluster (same Atlas domain).
        'mongodb+srv://u:p@cluster0.abc12.mongodb.net/e2e',
      ];
      expect([
        ...verdicts(sameCluster, noFlag),
        ...verdicts(sameCluster, withFlag),
      ]).toEqual([
        ...all(sameCluster, 'shared cluster'),
        ...all(sameCluster, 'shared cluster'),
      ]);
    });

    it('matches the .env cluster by host and port, so a local .env never blocks the in-memory server', () => {
      const localShared = 'mongodb://localhost:27017/travel';
      const options = { allowAtlas: true, sharedUri: localShared };
      const sameServer = [
        'mongodb://localhost:27017/e2e',
        'mongodb://localhost/other',
        'mongodb://127.0.0.1:27017/e2e',
      ];
      expect(
        verdicts(['mongodb://127.0.0.1:61234/e2e', ...sameServer], options),
      ).toEqual([
        'mongodb://127.0.0.1:61234/e2e: accepted',
        ...all(sameServer, 'shared cluster'),
      ]);
    });

    it('refuses a missing or malformed URI and never prints the URI it refuses', () => {
      expect(() => assertSafeTestUri(undefined, noFlag)).toThrow(
        'no test database URI',
      );
      expect(() => assertSafeTestUri('postgres://x/y', noFlag)).toThrow(
        'not a mongodb:// or mongodb+srv:// URI',
      );
      const messages: string[] = [];
      for (const [uri, options] of [
        [shared, withFlag],
        [sameClusterOtherDb, noFlag],
      ] as const) {
        try {
          assertSafeTestUri(uri, options);
        } catch (err) {
          messages.push((err as Error).message);
        }
      }
      expect(messages).toHaveLength(2);
      for (const m of messages) {
        expect(m).not.toContain('secret');
        expect(m).not.toContain('abc12');
      }
    });

    it('accepts the in-memory database this run uses', () => {
      expect(process.env.E2E_MONGODB_URI).toMatch(
        /^mongodb:\/\/127\.0\.0\.1:\d+\//,
      );
      expect(() =>
        assertSafeTestUri(process.env.E2E_MONGODB_URI, noFlag),
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

    // The exact body the validation pipe sends (validation.pipe.ts:33-38,
    // all-exceptions.filter.ts:35-39 adds path and timestamp).
    const validationError = (details: unknown) => ({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details,
      path: '/api/auth/register',
      timestamp: '2026-11-19T00:00:00.000Z',
    });

    it('skips field names only in the exact validation-error shape', () => {
      expect(
        findSensitiveKeys(
          validationError({
            password: ['password is too short'],
            passwordHash: ['property passwordHash should not exist'],
          }),
        ),
      ).toEqual([]);
      expect(isValidationErrorBody(validationError({ password: ['x'] }))).toBe(
        true,
      );
    });

    it('still finds passwordHash inside any other details object', () => {
      const leaks: [string, unknown][] = [
        // Another status, error or message, with the same details.
        [
          'a 409',
          {
            ...validationError({}),
            statusCode: 409,
            details: { passwordHash: 'h' },
          },
        ],
        [
          'another error',
          {
            ...validationError({}),
            error: 'Conflict',
            details: { passwordHash: 'h' },
          },
        ],
        [
          'another message',
          {
            ...validationError({}),
            message: 'Request failed',
            details: { passwordHash: 'h' },
          },
        ],
        // The validation shape, but a value that is not a list of strings.
        ['a string value', validationError({ passwordHash: 'h' })],
        [
          'a list with an object',
          validationError({ passwordHash: [{ x: 1 }] }),
        ],
        ['a nested object', validationError({ user: { passwordHash: 'h' } })],
        ['details as a list', validationError([{ passwordHash: 'h' }])],
        // A validation body nested in another object is not the top level.
        [
          'nested validation body',
          { error: validationError({ passwordHash: ['h'] }) },
        ],
        // No statusCode at all.
        ['a plain details object', { details: { passwordHash: 'h' } }],
      ];
      // One assertion for the whole table: a failure lists every shape.
      expect(
        leaks.map(
          ([name, body]) =>
            `${name}: ${
              findSensitiveKeys(body)
                .map((f) => f.key)
                .join(', ') || 'nothing found'
            }`,
        ),
      ).toEqual(leaks.map(([name]) => `${name}: passwordHash`));
    });

    it('a passwordHash in any other details object fails the run', async () => {
      // The real chain: recorder -> hit file -> check-coverage gate, on a
      // small Express app and its own run folder.
      const runDir = mkdtempSync(join(tmpdir(), 'travel-e2e-scan-'));
      try {
        const app = express();
        app.use(recorder(runDir));
        app.get('/validation', (_req, res) => {
          res.status(400).json(validationError({ password: ['too short'] }));
        });
        app.get('/conflict', (_req, res) => {
          res.status(409).json({
            ...validationError({}),
            statusCode: 409,
            error: 'Conflict',
            details: { passwordHash: 'h' },
          });
        });
        app.get('/not-a-list', (_req, res) => {
          res.status(400).json(validationError({ passwordHash: 'h' }));
        });
        app.get('/nested', (_req, res) => {
          res
            .status(400)
            .json(validationError({ user: { passwordHash: 'h' } }));
        });
        for (const path of [
          '/validation',
          '/conflict',
          '/not-a-list',
          '/nested',
        ]) {
          await request(app).get(path);
        }

        const result = checkCoverage({
          runDir,
          jestJson: join(runDir, 'none.json'),
          reportFile: join(runDir, 'report.md'),
        });
        const leaks = result.problems.filter((p) =>
          p.startsWith('sensitive key'),
        );
        expect(result.ok).toBe(false);
        expect(leaks).toEqual([
          'sensitive key "passwordHash" at details.passwordHash in the response of GET /conflict (409)',
          'sensitive key "passwordHash" at details.passwordHash in the response of GET /not-a-list (400)',
          'sensitive key "passwordHash" at details.user.passwordHash in the response of GET /nested (400)',
        ]);
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
    });

    it('counts neither [partial: ...] IDs nor setup requests as coverage', () => {
      const runDir = mkdtempSync(join(tmpdir(), 'travel-e2e-gate-'));
      try {
        const route = {
          key: 'GET /api/example',
          method: 'GET',
          path: '/api/example',
          isPublic: true,
          roles: [],
          inSwagger: true,
          declared: true,
        };
        writeFileSync(join(runDir, 'routes-1.json'), JSON.stringify([route]));
        // Only a setup request reached the route.
        writeFileSync(
          join(runDir, 'hits-1.jsonl'),
          JSON.stringify({
            kind: 'hit',
            route: route.key,
            status: 200,
            setup: true,
          }) + '\n',
        );
        const jestJson = join(runDir, 'jest.json');
        writeFileSync(
          jestJson,
          JSON.stringify({
            testResults: [
              {
                assertionResults: [
                  {
                    status: 'passed',
                    fullName: 'a check (ACC-11) [partial: GEN-10, BLG-02]',
                  },
                ],
              },
            ],
          }),
        );
        const result = checkCoverage({
          runDir,
          jestJson,
          requirementExclusions: {},
          routeExclusions: {},
          reportFile: join(runDir, 'report.md'),
        });
        const about = (id: string) =>
          result.problems.filter((p) => p.startsWith(`requirement ${id} `));
        expect({
          ACC11: about('ACC-11'),
          GEN10: about('GEN-10'),
          BLG02: about('BLG-02'),
          route: result.problems.filter((p) => p.startsWith('route ')),
        }).toEqual({
          ACC11: [],
          GEN10: [
            'requirement GEN-10 (M1) is named in no passing test and not excluded',
          ],
          BLG02: [
            'requirement BLG-02 (M1) is named in no passing test and not excluded',
          ],
          route: ['route GET /api/example: no 2xx'],
        });
        expect(result.report).toContain(
          '- **GEN-10**\n  - a check (ACC-11) [partial: GEN-10, BLG-02]',
        );
        expect(result.report).toContain(
          '1 setup requests (x-e2e-setup) not counted',
        );
      } finally {
        rmSync(runDir, { recursive: true, force: true });
      }
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
