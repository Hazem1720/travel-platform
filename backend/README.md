# Backend (NestJS + MongoDB)

Milestone 1 backend for the Travel Planning and Booking Platform. For setup (Node.js, cloning, `backend/.env`) see the [root README](../README.md); the variables are listed in [`.env.example`](../.env.example).

## Commands (run in `backend/`)

| Command | What it does |
|---|---|
| `npm run start:dev` | Start with reload. Swagger UI at http://localhost:3000/api/docs |
| `npm run build` | Compile to `dist/` |
| `npm test` | Unit tests. They need no database and no `.env` |
| `npm run test:e2e` | HTTP tests through the real app setup. The database flow runs only when `E2E_MONGODB_URI` is set (see below) |
| `npm run seed:reference` | Load the official countries, cities, airports and attractions from `seed-data/` |
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

## End-to-end tests with a database

The e2e database flow registers a user, logs in, logs out and checks that the old token is rejected. It writes to the database, so it runs only against a database you name in `E2E_MONGODB_URI`, never against `MONGODB_URI`:

```bash
E2E_MONGODB_URI=mongodb://127.0.0.1:27017/travel_platform_e2e npm run test:e2e
```

Use a local MongoDB or a separate Atlas database, **never the shared team database**. The test deletes the user it creates.

## Seeding

`seed-data/*.csv` must stay identical to the official `Mock Data.xlsx`; `npm test` checks the record counts and identifiers. `npm run seed:reference` validates every row (required fields, IANA time zones, city and country links) before writing anything, and is safe to repeat. Add `-- --prune` to delete records that are no longer in the files.
