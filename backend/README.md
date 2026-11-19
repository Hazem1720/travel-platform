# Backend (NestJS + MongoDB)

Milestone 1 backend for the Travel Planning and Booking Platform. For setup (Node.js, cloning, `backend/.env`) see the [root README](../README.md); the variables are listed in [`.env.example`](../.env.example).

## Commands (run in `backend/`)

| Command | What it does |
|---|---|
| `npm run start:dev` | Start with reload. Swagger UI at http://localhost:3000/api/docs |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit tests. They need no database and no `.env` |
| `npm run test:e2e:full` | The whole e2e suite on an in-memory MongoDB, then the coverage gates (see below). This is what CI runs |
| `npm run test:e2e` | The e2e tests only, without the gates; add a file name to run one suite |
| `npm run seed:reference` | Load the official countries, cities, airports, attractions and the supported currencies from `seed-data/` (the server also does this when it starts) |
| `npm run seed:admin` | Create the admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |
| `npx eslint "{src,test}/**/*.ts"` | Lint without changing files |
| `npm run lint` | Lint **and fix**: this edits files |
| `npm run format` | Format `src/` and `test/` with Prettier |

## How it is organised

```
src/
  main.ts, app.setup.ts   bootstrap; configureApp() is shared with the e2e tests
  config/                 environment validation (the app stops if a setting is wrong)
  auth/                   register, login, refresh, logout, change password, /auth/me, guards
  users/                  user schema and /users/me
  reference/              countries, cities, airports, attractions (read-only reference data)
  seed/                   seed scripts and seed-data validation
  common/                 decorators, error filter, validation pipe, pagination, currencies, Swagger helpers
seed-data/                exact copies of the official datasets
test/                     e2e tests and Jest setup files
```

## Rules every module follows

- **Authentication (GEN-13).** `JwtAuthGuard` and `RolesGuard` are global: every route needs a session unless it is marked `@Public()`. Public routes are listed in `src/auth/route-guards.spec.ts`, and that test fails if a route is public without being listed. Restrict by role with `@Roles(...)`. Moderator routes call `assertOwnsProvider()`.
- **Sessions (ACC-06, ACC-19).** Tokens live only in httpOnly, Secure, SameSite cookies. 30 minutes without activity ends the session. Logout and password change revoke every token issued before.
- **Validation and errors (GEN-02).** Every body and query uses a DTO with class-validator. Errors use one format, `{ statusCode, error, message, details?, path, timestamp }`, with `details` keyed by field.
- **Lists (GEN-05).** Use `PaginationQueryDto` and `paginated()`; the page size is 10.
- **Currencies (GEN-12).** Validate currency fields with `@IsSupportedCurrency()`.
- **Swagger.** Every route has `@ApiOperation` (with requirement IDs), a success response and its error responses (`ApiErrors(...)`).

The team conventions, including open proposals, are in [`docs/api/conventions.md`](../docs/api/conventions.md).

## End-to-end tests

The plan is in [`test/E2E_PLAN.md`](test/E2E_PLAN.md). The tests boot the real `AppModule` and call it over HTTP, on a real MongoDB that `mongodb-memory-server` starts for each run (the first run downloads the `mongod` binary once). Every test app gets its own `e2e-...` database and drops it at the end. Stripe's API, SMTP and FXRatesAPI are faked; every other network call is blocked. No `.env` is needed.

`npm run test:e2e:full` then runs the coverage gates and writes `coverage/e2e-coverage.md`:

- every M1 requirement in the tracker is named in a passing test, or listed in `test/e2e/requirement-exclusions.ts` with a reason;
- every route has a 2xx response, a 401 unless it is public, a 403 if it has `@Roles`, and a Swagger entry, or is listed in `test/e2e/route-exclusions.ts`;
- no response body contains a password hash, token or card field.

An exclusion that is no longer needed also fails, so remove the IDs and routes your tests cover.

To use another database instead, set `E2E_MONGODB_URI` in the shell (not in `.env`). Without a flag the tests accept only `127.0.0.1` and `localhost`. Any other host (Atlas in either form, another machine) also needs `E2E_ALLOW_ATLAS=1`, for a separate throwaway database. The shared database from `backend/.env` is refused even with the flag:

```bash
E2E_MONGODB_URI=mongodb://127.0.0.1:27017/travel_platform_e2e npm run test:e2e:full
```

## Seeding

`seed-data/*.csv` must stay identical to the official `Mock Data.xlsx`; `npm test` checks the record counts and identifiers. `npm run seed:reference` validates every row (required fields, IANA time zones, city and country links) before writing anything, and is safe to repeat. Add `-- --prune` to delete records that are no longer in the files. The server runs the same load when it starts unless `SEED_REFERENCE_ON_START=false`.
