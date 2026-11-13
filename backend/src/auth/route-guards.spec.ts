import { INestApplication, RequestMethod, Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

// GEN-13: every route needs a session unless it is deliberately public.
// Adding a public route means adding it here, so the change is reviewed.
const PUBLIC_ROUTES = [
  'GET /',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /airlines/:id',
];

interface Route {
  key: string;
  method: string;
  path: string;
  isPublic: boolean;
  hasRoles: boolean;
  localGuards: unknown[];
}

// Walks the module tree from AppModule, including dynamic modules.
function collectModules(root: unknown): {
  controllers: Type[];
  providers: unknown[];
} {
  const seen = new Set<unknown>();
  const controllers: Type[] = [];
  const providers: unknown[] = [];
  const visit = (mod: any) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    const cls = typeof mod === 'function' ? mod : mod.module;
    const meta = (key: string) => [
      ...(cls ? (Reflect.getMetadata(key, cls) ?? []) : []),
      ...(typeof mod === 'object' ? (mod[key] ?? []) : []),
    ];
    controllers.push(...meta(MODULE_METADATA.CONTROLLERS));
    providers.push(...meta(MODULE_METADATA.PROVIDERS));
    meta(MODULE_METADATA.IMPORTS).forEach(visit);
  };
  visit(root);
  return { controllers, providers };
}

function joinPath(...parts: (string | string[] | undefined)[]) {
  const segs = parts
    .map((p) => (Array.isArray(p) ? p[0] : p) ?? '')
    .flatMap((p) => p.split('/'))
    .filter(Boolean);
  return '/' + segs.join('/');
}

function collectRoutes(controllers: Type[]): Route[] {
  const routes: Route[] = [];
  for (const ctrl of controllers) {
    const proto = ctrl.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler);
      if (verb === undefined) continue;
      const method = RequestMethod[verb as RequestMethod];
      const path = joinPath(
        Reflect.getMetadata(PATH_METADATA, ctrl),
        Reflect.getMetadata(PATH_METADATA, handler),
      );
      const meta = (key: string) =>
        Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, ctrl);
      routes.push({
        key: `${method} ${path}`,
        method,
        path,
        isPublic: meta(IS_PUBLIC_KEY) === true,
        hasRoles: (meta(ROLES_KEY) ?? []).length > 0,
        localGuards: [
          ...(Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? []),
          ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
        ],
      });
    }
  }
  return routes;
}

describe('route protection (GEN-13)', () => {
  const { controllers, providers } = collectModules(AppModule);
  const routes = collectRoutes(controllers);
  const globalGuards = providers
    .filter((p: any) => p?.provide === APP_GUARD)
    .map((p: any) => p.useExisting ?? p.useClass);

  it('finds the application routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  it('registers JwtAuthGuard then RolesGuard as global guards', () => {
    expect(globalGuards).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it('protects every route that is not @Public()', () => {
    const jwtIsGlobal = globalGuards.includes(JwtAuthGuard);
    const unprotected = routes
      .filter((r) => !r.isPublic)
      .filter((r) => !jwtIsGlobal && !r.localGuards.includes(JwtAuthGuard))
      .map((r) => r.key);
    expect(unprotected).toEqual([]);
  });

  it('only makes the reviewed routes public', () => {
    const publicRoutes = routes.filter((r) => r.isPublic).map((r) => r.key);
    expect(publicRoutes.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('never combines @Public() with @Roles()', () => {
    expect(
      routes.filter((r) => r.isPublic && r.hasRoles).map((r) => r.key),
    ).toEqual([]);
  });

  describe('over HTTP without a session', () => {
    let app: INestApplication;

    beforeAll(async () => {
      // The real AppModule with only the database replaced, so the real
      // global guards and controllers are exercised.
      const fakeModel = {};
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(getConnectionToken())
        .useValue({
          models: {},
          model: () => fakeModel,
          close: async () => undefined,
        })
        .compile();
      app = moduleRef.createNestApplication({ logger: false });
      app.use(cookieParser());
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('rejects every non-public route with 401', async () => {
      const results: string[] = [];
      for (const r of routes.filter((x) => !x.isPublic)) {
        const res = await (request(app.getHttpServer()) as any)[
          r.method.toLowerCase()
        ](r.path);
        if (res.status !== 401) results.push(`${r.key} -> ${res.status}`);
      }
      expect(results).toEqual([]);
    });
  });
});
