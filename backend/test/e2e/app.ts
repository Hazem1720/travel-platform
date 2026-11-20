import { INestApplication, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { Connection, createConnection, Model } from 'mongoose';
import { join } from 'path';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { buildSwaggerDocument, configureApp } from '../../src/app.setup';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { EmailService } from '../../src/email/email.service';
import { StripeGateway } from '../../src/payments/stripe.gateway';
import { UploadsService } from '../../src/uploads/uploads.service';
import { FakeStripeGateway, Outbox } from './fakes';
import { recorder } from './recorder';
import { ROUTES_PREFIX } from './run-dir';

export interface TestApp {
  app: INestApplication;
  // A fresh supertest client (no cookies). Use actors.ts for a session.
  http: () => request.SuperTest<request.Test>;
  server: any;
  conn: Connection;
  dbName: string;
  stripe: FakeStripeGateway;
  outbox: Outbox;
  // A Mongoose model by schema name, for arranging data only (HTTP rule).
  model: <T = any>(name: string) => Model<T>;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  // Extra overrides, for a suite that needs one more fake.
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

const DB_PREFIX = 'e2e-';

// Boots the real AppModule with the same pipeline as main.ts (global
// prefix, cookies, validation pipe, error filter, rawBody for the webhook),
// on its own database. Only Stripe's API and SMTP are replaced.
export async function createTestApp(
  suite: string,
  options: TestAppOptions = {},
): Promise<TestApp> {
  const runDir = process.env.E2E_RUN_DIR;
  if (!runDir) throw new Error('E2E_RUN_DIR is not set (see global-setup.ts)');

  // MongoDB allows 63 characters; keep the suite name short and readable.
  const slug = suite
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 30);
  const dbName = `${DB_PREFIX}${slug}-${randomUUID().slice(0, 8)}`;
  const conn = await createConnection(process.env.E2E_MONGODB_URI!, {
    dbName,
  }).asPromise();

  const outbox = new Outbox();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getConnectionToken())
    .useValue(conn)
    .overrideProvider(StripeGateway)
    .useFactory({
      factory: (config: ConfigService) => new FakeStripeGateway(config),
      inject: [ConfigService],
    });
  if (options.override) builder = options.override(builder);

  const app = (await builder.compile()).createNestApplication({
    rawBody: true,
    logger: process.env.E2E_LOG === '1' ? undefined : false,
  });
  // Before configureApp and before init, so it runs ahead of every route.
  app.use(recorder(runDir));
  configureApp(app);

  // Uploaded files go to this run's folder, never to backend/uploads.
  const uploads = app.get(UploadsService);
  uploads.dir = join(runDir, 'uploads', dbName);
  // GEN-01-B: emails land in the outbox instead of an SMTP server.
  (app.get(EmailService) as any).transport = outbox.transport;
  holdResponsesUntilEmailsSent(app);

  await app.init();

  // Cron jobs, intervals and timeouts are stopped: a job runs only when a
  // test calls it through app.get(...), never in the middle of a test.
  stopScheduler(app);

  // Every index exists before the first test, so a race test never runs
  // before the unique index that decides it.
  await Promise.all(conn.modelNames().map((n) => conn.model(n).init()));

  writeRoutes(app, runDir);

  const server = app.getHttpServer();
  return {
    app,
    http: () => request(server) as any,
    server,
    conn,
    dbName,
    stripe: app.get(StripeGateway) as FakeStripeGateway,
    outbox,
    model: <T = any>(name: string) => app.get<Model<T>>(getModelToken(name)),
    close: async () => {
      await dropTestDatabase(conn);
      await app.close();
    },
  };
}

// The app sends emails in the background, after the request that caused
// them may already have answered. In tests that would make reading the
// outbox a race. So every email the app starts is tracked, and each
// response is held until the emails started before it are in the outbox.
// Test-only: production behaviour is unchanged.
const EMAIL_METHODS = [
  'sendNotification',
  'sendModeratorInvitation',
  'sendEmailVerification',
  'sendPasswordReset',
] as const;

function holdResponsesUntilEmailsSent(app: INestApplication) {
  const email = app.get(EmailService) as any;
  const pending = new Set<Promise<unknown>>();
  for (const name of EMAIL_METHODS) {
    const original = email[name].bind(email);
    email[name] = (...args: unknown[]) => {
      const sending: Promise<unknown> = original(...args);
      pending.add(sending);
      void sending.then(
        () => pending.delete(sending),
        () => pending.delete(sending),
      );
      return sending;
    };
  }
  app.use((_req: unknown, res: any, next: () => void) => {
    const end = res.end.bind(res);
    res.end = (...args: unknown[]) => {
      if (!pending.size) return end(...args);
      void Promise.allSettled([...pending]).then(() => end(...args));
      return res;
    };
    next();
  });
}

// Drops the connection's database, only if it is a test database.
export async function dropTestDatabase(conn: Connection): Promise<void> {
  const name = conn.db?.databaseName ?? conn.name;
  if (!name || !name.startsWith(DB_PREFIX)) {
    throw new Error(
      `dropTestDatabase: refusing to drop "${name}" (not an ${DB_PREFIX} database)`,
    );
  }
  await conn.dropDatabase();
}

function stopScheduler(app: INestApplication) {
  const registry = app.get(SchedulerRegistry);
  for (const job of registry.getCronJobs().values()) job.stop();
  for (const name of registry.getIntervals()) registry.deleteInterval(name);
  for (const name of registry.getTimeouts()) registry.deleteTimeout(name);
}

export interface RouteInfo {
  key: string; // "GET /api/hotels/:id"
  method: string;
  path: string;
  isPublic: boolean;
  roles: string[];
  inSwagger: boolean;
  // False if the route is in Express but no controller declares it.
  declared: boolean;
}

// Every route Express really serves (Nest's router stack, not Swagger, not
// a text search), with its guards' metadata and whether Swagger lists it.
export function collectRoutes(app: INestApplication): RouteInfo[] {
  const stack: any[] = app.getHttpAdapter().getInstance()._router.stack;
  const served = stack
    .filter((layer) => layer.route)
    .flatMap((layer) =>
      Object.keys(layer.route.methods).map(
        (m) => `${m.toUpperCase()} ${layer.route.path}`,
      ),
    );

  const declared = new Map<string, { isPublic: boolean; roles: string[] }>();
  for (const [key, { controller, method }] of routeHandlers(app)) {
    const handler = controller.prototype[method];
    const meta = (k: string) =>
      Reflect.getMetadata(k, handler) ?? Reflect.getMetadata(k, controller);
    declared.set(key, {
      isPublic: meta(IS_PUBLIC_KEY) === true,
      roles: meta(ROLES_KEY) ?? [],
    });
  }

  const doc = buildSwaggerDocument(app);
  const swagger = new Set(
    Object.entries(doc.paths).flatMap(([p, item]) =>
      Object.keys(item as object).map(
        (m) => `${m.toUpperCase()} ${p.replace(/\{([^}]+)\}/g, ':$1')}`,
      ),
    ),
  );

  return [...new Set(served)].sort().map((key) => {
    const [method, path] = key.split(' ');
    const meta = declared.get(key);
    return {
      key,
      method,
      path,
      isPublic: meta?.isPublic ?? false,
      roles: meta?.roles ?? [],
      inSwagger: swagger.has(key),
      declared: !!meta,
    };
  });
}

// The controller class and method behind each declared route, keyed like
// RouteInfo.key ("GET /api/hotels/:id"), for suites that inspect a
// handler's metadata (for example its @Body DTO).
export function routeHandlers(
  app: INestApplication,
): Map<string, { controller: any; method: string }> {
  const out = new Map<string, { controller: any; method: string }>();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as any;
      if (!ctrl?.prototype) continue;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = ctrl.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue;
        const path = joinPath(
          'api',
          Reflect.getMetadata(PATH_METADATA, ctrl),
          Reflect.getMetadata(PATH_METADATA, handler),
        );
        out.set(`${RequestMethod[verb]} ${path}`, {
          controller: ctrl,
          method: name,
        });
      }
    }
  }
  return out;
}

function joinPath(...parts: (string | string[] | undefined)[]) {
  const segs = parts
    .map((p) => (Array.isArray(p) ? p[0] : p) ?? '')
    .flatMap((p) => p.split('/'))
    .filter(Boolean);
  return '/' + segs.join('/');
}

// Every boot writes the same list, so it does not matter which suite runs
// first; check-coverage.ts reads it after the run. One file per worker
// process, so two workers never write the same file.
function writeRoutes(app: INestApplication, runDir: string) {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, `${ROUTES_PREFIX}${process.pid}.json`),
    JSON.stringify(collectRoutes(app), null, 2),
  );
}
