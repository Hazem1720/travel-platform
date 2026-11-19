import { RequestMethod, Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { getMetadataStorage } from 'class-validator';
import { AppModule } from '../../app.module';
import { PAGE_SIZE } from './pagination-query.dto';

// GEN-05: "The system shall paginate every list longer than 10 rows (page
// size 10)." The rule is in docs/api/conventions.md (Lists). This test makes
// CI enforce it: every GET route must be listed below, either as a list or as
// a route that is not a list, with the reason. A new GET route that is in
// neither fails, so its author has to decide.
//
// A list must take a query DTO built on PaginationQueryDto (page, and limit
// at most 10) and document a { data, meta } response (paginated()).
// `pages` names the response keys holding pages when there are several.
// `openPr` marks a route that is still in an open PR: it may be missing here
// until that PR is merged.
const LISTS: Record<string, { pages?: string[]; openPr?: number }> = {
  'GET /admin/accounts': {},
  'GET /admin/audit-logs': {},
  'GET /admin/bookings': { openPr: 211 },
  'GET /admin/reports': {},
  'GET /airlines/:id/flights': {},
  'GET /airports': {},
  'GET /authors/:id': { pages: ['posts', 'itineraries'] },
  'GET /favourites': {},
  'GET /flight-bookings': { openPr: 209 },
  'GET /flights/:id/bookings': { openPr: 210 },
  'GET /flights/search': {},
  'GET /hotel-bookings': { openPr: 200 },
  'GET /hotels/:id/availability': { openPr: 215 },
  'GET /hotels/:id/reservations': { openPr: 213 },
  'GET /hotels/:id/reviews': { openPr: 207 },
  'GET /hotels/:id/rooms/available': {},
  'GET /hotels/search': {},
  'GET /itineraries': {},
  'GET /itineraries/:id/bookings': {},
  'GET /itineraries/:id/flights': {},
  'GET /itineraries/:id/hotels': {},
  'GET /itineraries/public/search': {},
  'GET /notifications': {},
  'GET /posts': {},
  'GET /posts/:id/comments': {},
  'GET /posts/mine': {},
  'GET /reference/attractions': {},
  'GET /reference/cities': {},
  'GET /reference/countries': {},
  'GET /reference/currencies': {},
  'GET /tags/:tag/posts': {},
};

const ONE_RECORD = 'one record, not a list';
const FILE = 'a file download';
const NOT_LISTS: Record<string, { reason: string; openPr?: number }> = {
  'GET /': { reason: 'health check text' },
  'GET /admin/content/:type/:id': { reason: 'one reported item' },
  'GET /airlines/:id': { reason: ONE_RECORD },
  'GET /auth/me': { reason: 'the logged-in user' },
  'GET /auth/verify-email': { reason: 'the email verification link' },
  'GET /bookings/:type/:id/policies': { reason: "one booking's policies" },
  'GET /flight-bookings/:id': { reason: ONE_RECORD },
  'GET /flight-bookings/:id/cancellation': {
    reason: "one booking's refund preview",
    openPr: 216,
  },
  'GET /flight-bookings/:id/e-ticket': { reason: FILE },
  'GET /flight-bookings/:id/seats': {
    reason: "one flight's seat map, drawn as a plane, not a list",
  },
  'GET /flights/:id': { reason: ONE_RECORD },
  'GET /flights/:id/passengers/export': { reason: FILE, openPr: 210 },
  'GET /hotel-bookings/:id': { reason: ONE_RECORD },
  'GET /hotel-bookings/:id/cancellation': {
    reason: "one booking's refund preview",
    openPr: 214,
  },
  'GET /hotels/:id': {
    reason:
      'one hotel; its free rooms are paged at /hotels/:id/rooms/available',
  },
  'GET /itineraries/:id': {
    reason: 'one itinerary; its days (60 at most) are its content',
  },
  'GET /itineraries/:id/budget-summary': { reason: 'totals' },
  'GET /itineraries/:id/pdf': { reason: FILE },
  'GET /itineraries/public/:id': {
    reason: 'one itinerary; its days (60 at most) are its content',
  },
  'GET /notifications/unread-count': { reason: 'a count' },
  'GET /posts/:id': {
    reason: 'one post; its comments are paged at /posts/:id/comments',
  },
  'GET /refunds/:id': { reason: ONE_RECORD },
  'GET /payments/:id': { reason: ONE_RECORD },
  'GET /uploads/:file': { reason: FILE },
  'GET /users/me': { reason: 'the logged-in user' },
};

function controllersOf(root: unknown): Type[] {
  const seen = new Set<unknown>();
  const out: Type[] = [];
  const visit = (mod: any) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    const cls = typeof mod === 'function' ? mod : mod.module;
    const meta = (key: string) => [
      ...(cls ? (Reflect.getMetadata(key, cls) ?? []) : []),
      ...(typeof mod === 'object' ? (mod[key] ?? []) : []),
    ];
    out.push(...meta(MODULE_METADATA.CONTROLLERS));
    meta(MODULE_METADATA.IMPORTS).forEach(visit);
  };
  visit(root);
  return [...new Set(out)];
}

interface GetRoute {
  key: string;
  queryTypes: unknown[];
  ok: { type?: unknown; schema?: { example?: unknown } } | undefined;
}

function getRoutes(): GetRoute[] {
  const routes: GetRoute[] = [];
  for (const ctrl of controllersOf(AppModule)) {
    const proto = ctrl.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) {
        continue;
      }
      const path = [
        Reflect.getMetadata(PATH_METADATA, ctrl),
        Reflect.getMetadata(PATH_METADATA, handler),
      ]
        .filter((p) => p && p !== '/')
        .join('/');
      const args: Record<string, { index: number }> =
        Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {};
      const types: unknown[] =
        Reflect.getMetadata('design:paramtypes', proto, name) ?? [];
      const responses = Reflect.getMetadata('swagger/apiResponse', handler);
      routes.push({
        key: `GET /${path}`,
        queryTypes: Object.entries(args)
          .filter(([k]) => Number(k.split(':')[0]) === RouteParamtypes.QUERY)
          .map(([, a]) => types[a.index]),
        ok: responses?.['200'],
      });
    }
  }
  return routes;
}

// page >= 1 and 1 <= limit <= PAGE_SIZE, as in PaginationQueryDto.
function isPaginationQuery(type: unknown): boolean {
  if (typeof type !== 'function') return false;
  const rules = getMetadataStorage().getTargetValidationMetadatas(
    type as new () => object,
    '',
    true,
    false,
  );
  const has = (field: string, rule: string, value: number) =>
    rules.some(
      (r) =>
        r.propertyName === field &&
        r.name === rule &&
        r.constraints?.[0] === value,
    );
  return has('page', 'min', 1) && has('limit', 'max', PAGE_SIZE);
}

// The documented 200 response has { data, meta } (at `page` when given).
function documentsPage(ok: GetRoute['ok'], page?: string): boolean {
  if (!ok) return false;
  if (ok.type && !page) {
    const props: string[] =
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        (ok.type as Type).prototype,
      ) ?? [];
    return props.includes(':data') && props.includes(':meta');
  }
  const example = ok.schema?.example as Record<string, any> | undefined;
  const target = page ? example?.[page] : example;
  return !!target && 'data' in target && 'meta' in target;
}

describe('GEN-05: every list is paginated, 10 per page', () => {
  const routes = getRoutes();
  const keys = new Set(routes.map((r) => r.key));

  it('finds the GET routes of the application', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('lists every GET route either as a list or as not a list', () => {
    const unlisted = [...keys].filter(
      (k) => !(k in LISTS) && !(k in NOT_LISTS),
    );
    const both = Object.keys(LISTS).filter((k) => k in NOT_LISTS);
    expect({ unlisted, both }).toEqual({ unlisted: [], both: [] });
  });

  it('has no entries for routes that no longer exist', () => {
    const stale = [...Object.entries(LISTS), ...Object.entries(NOT_LISTS)]
      .filter(([k, v]) => !keys.has(k) && v.openPr === undefined)
      .map(([k]) => k);
    expect(stale).toEqual([]);
  });

  it('takes ?page and ?limit (at most 10) on every list', () => {
    const missing = routes
      .filter((r) => r.key in LISTS)
      .filter((r) => !r.queryTypes.some(isPaginationQuery))
      .map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it('documents a { data, meta } response for every list', () => {
    const missing = routes
      .filter((r) => r.key in LISTS)
      .filter((r) => {
        const pages = LISTS[r.key].pages;
        return pages
          ? !pages.every((p) => documentsPage(r.ok, p))
          : !documentsPage(r.ok);
      })
      .map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it('notices a list without pagination', () => {
    class PlainQuery {}
    expect(isPaginationQuery(PlainQuery)).toBe(false);
    expect(documentsPage({ schema: { example: [{ id: 1 }] } })).toBe(false);
  });
});
