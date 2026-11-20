# Travel Planning and Booking Platform

GIU Software Project I, Winter 2026.

A platform for planning trips and booking them in one place. Travellers search and book flights and hotel rooms, pay through Stripe (test mode), build day-by-day itineraries with a budget in their own currency, and write blog posts. Airline and hotel moderators each manage their own airline or hotel, and admins manage accounts, bookings and reported content.

| Part | Technology | Folder | Milestone |
|---|---|---|---|
| Backend API | NestJS, MongoDB Atlas (Mongoose), Swagger | [`backend/`](backend/) | 1 |
| Frontend | Next.js | `frontend/` (not created yet) | 2 |

- Requirements and the requirements tracker: [`docs/requirements/`](docs/requirements/)
- API conventions (schemas, statuses, errors, pagination): [`docs/api/conventions.md`](docs/api/conventions.md)
- Backend commands, structure, rules and tests: [`backend/README.md`](backend/README.md)
- AI usage log: [`AI_PROMPTS.txt`](AI_PROMPTS.txt)

## Run the backend locally

1. Install Node.js 20 or newer (CI uses 20) and Git.
2. Clone the repository and switch to `develop`, the branch all work starts from:

   ```bash
   git clone https://github.com/Hazem1720/travel-platform.git
   cd travel-platform
   git checkout develop
   ```

3. Install the exact package versions from `package-lock.json`:

   ```bash
   cd backend
   npm ci
   ```

4. Copy [`.env.example`](.env.example) from the repository root to `backend/.env` and fill it in. **Never commit this file.** Three settings are required; the server checks them at startup and stops with a message if one is missing or invalid:

   | Setting | Value |
   |---|---|
   | `MONGODB_URI` | The team connection string (ask a team leader) |
   | `JWT_SECRET` | Your own random text, at least 32 characters |
   | `FRONTEND_URL` | The frontend address, for example `http://localhost:3001` |

   Generate a secret with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Every other setting is optional and explained in `.env.example`: Stripe, FXRatesAPI, email (SMTP), the admin seed and the platform currency. Keep `COOKIE_SECURE=true`; set it to `false` only if your browser drops cookies on `http://localhost` (for example Safari). The server refuses `false` when `NODE_ENV=production`.

5. Start the server with reload:

   ```bash
   npm run start:dev
   ```

6. Open Swagger at http://localhost:3000/api/docs (the JSON is at `/api/docs-json`).

### MongoDB connection problem (`querySrv ECONNREFUSED`)

Some networks block the DNS lookup used by `mongodb+srv://` strings. In MongoDB Atlas, open Connect, then Drivers, switch on **Legacy URI String**, copy that `mongodb://` string into your own `.env`, and add `/travel-platform` before the `?`.

### Seed the database

The server loads the reference data by itself every time it starts (GEN-12): the official countries, cities, airports and attractions in `backend/seed-data`, and the supported currencies. Set `SEED_REFERENCE_ON_START=false` to turn this off.

```bash
npm run seed:reference   # the same load on demand; prints what it wrote
npm run seed:admin       # creates the admin account once
```

`seed:reference` checks every file first and writes nothing if a record is invalid. It is safe to run again. Add `-- --prune` to also delete records that are no longer in the files.

`seed:admin` needs `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `backend/.env`. The password must follow the account rule (at least 8 characters, a letter and a digit). Running it again never changes an existing admin's password unless you add `-- --reset-password`.

### Test payments locally (PAY-01, Stripe test mode)

Without the Stripe keys the server still starts; only paying answers 503.

1. In the Stripe dashboard, in a **sandbox** (test mode), open Developers, then API keys, and copy the secret key into `STRIPE_SECRET_KEY`. It must start with `sk_test_`: the server refuses live keys.
2. Install the Stripe CLI (`winget install Stripe.StripeCli` on Windows) and run `stripe login`, choosing the same sandbox.
3. Run `stripe listen --print-secret` and put the `whsec_...` it prints in `STRIPE_WEBHOOK_SECRET`. Restart the server.
4. Keep this running while you test, so Stripe's events reach your server (recent Stripe CLI versions refuse `stripe listen` without `--events`):

   ```bash
   stripe listen --forward-to localhost:3000/api/payments/webhook --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,refund.created,refund.updated,refund.failed,charge.refund.updated
   ```

5. Hold a booking, accept its policies, then call `POST /api/bookings/{type}/{id}/pay`. The `clientSecret` it returns starts with the PaymentIntent id (`pi_..._secret_...`). Without a frontend, pay it from the CLI with a test card:

   ```bash
   stripe payment_intents confirm pi_... --payment-method pm_card_visa
   ```

   Use `pm_card_chargeDeclined` to see a declined card. The booking becomes Confirmed only when the webhook arrives.

6. Refunds (PAY-03) are made when a booking is cancelled, and their status arrives through the same webhook. Pay with `pm_card_refundFail` to see a refund that the bank rejects later (Refunded, then Failed).

### Email notifications (GEN-01-B, optional)

Every in-app notification (GEN-01) and every new moderator invitation (ACC-13) is also sent by email when `SMTP_HOST` is set in `backend/.env` (with `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM`). Use a test inbox in development, for example a free Mailtrap or Ethereal inbox. Leave `SMTP_HOST` empty to turn email off. If the mail server is down, the in-app notification is still created and the error is only logged. The invitation never contains the temporary password.

## Tests and CI

Run these from `backend/`. Neither needs `backend/.env` or the shared database.

```bash
npm test                # unit tests
npm run test:e2e:full   # end-to-end tests on an in-memory MongoDB, then the coverage gates
```

The end-to-end tests start the real app and call it over HTTP. Stripe, SMTP and FXRatesAPI are faked. The coverage gates check that every Milestone 1 requirement and every route is tested. [`backend/README.md`](backend/README.md#end-to-end-tests) explains the details, and [`backend/test/E2E_PLAN.md`](backend/test/E2E_PLAN.md) is the test plan.

[CI](.github/workflows/ci.yml) runs on every pull request and every push to `develop` or `main`: install, build, unit tests, lint (read-only), the end-to-end tests with the coverage gates, and a load test. A pull request is merged only when CI passes.

For a read-only lint check, use `npx eslint "{src,test}/**/*.ts"`. `npm run lint` fixes files in place.

## Git workflow

- `main` holds the released milestone versions. `develop` is the integration branch: every branch starts from it and every pull request targets it. Pass `--base develop` to `gh pr create`, because the repository's default branch is `main`.
- Never push directly to `main` or `develop`, and never force-push.
- Branch names: `feature/<REQ-ID>-<description>` (for example `feature/FLT-22-seat-hold`), `fix/<REQ-ID>-<description>`, `docs/<description>`, `refactor/<description>`.
- Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/) with the requirement IDs, for example `feat(flights): add round-trip search (FLT-11)` or `fix(hotels): prevent double booking (HTL-18)`.
- Every requirement has one GitHub issue titled `[REQ-ID] ...`. Fill in the [pull request template](.github/pull_request_template.md), put `Closes #<issue>` in the description for each requirement the pull request finishes, and explain how to test it in Swagger.
- One of the two team leaders reviews and merges every pull request, with a merge commit, after CI passes.
- Never commit `.env`, connection strings or API keys.

## Project structure (backend)

```
backend/
  src/
    common/       shared enums, decorators, helpers, pagination, error filter
    config/       environment validation
    auth/         sign-up, login, sessions, the global guards
    users/        user schema and profile
    reference/    countries, cities, airports, attractions, currencies
    seed/         seed scripts
    ...           one folder per feature (airlines, flights, hotels, payments, itineraries, blog, admin, ...)
  seed-data/      exact copies of the official datasets
  test/           end-to-end tests and the test plan
```

## Protecting routes in your module

`JwtAuthGuard` and `RolesGuard` apply to every route automatically, so a controller does not add them with `@UseGuards`. Every route needs a session unless it is marked `@Public()` (and listed in `PUBLIC_ROUTES` in `src/auth/route-guards.spec.ts`). Restrict a route to roles with `@Roles()`:

```ts
@ApiCookieAuth('access_token')
@Roles(Role.AIRLINE_MODERATOR)
@Post()
create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto) { ... }
```

A moderator manages exactly one airline or hotel, so moderator routes also call `assertOwnsProvider(user, Role.AIRLINE_MODERATOR, airlineId)`. Private bookings and itineraries are checked for ownership on the backend and answer 404 to other users.

## API conventions

The full list is in [`docs/api/conventions.md`](docs/api/conventions.md). In short:

- Every route starts with `/api`. Errors: `{ statusCode, error, message, details?, path, timestamp }`.
- Lists: `?page=1&limit=10&sort=field:asc`. Use `PaginationQueryDto` and `paginated()` from `common/pagination`.
- Money: one platform currency, USD (`PLATFORM_CURRENCY`), stored as integer cents (PAY-04).
- Dates are ISO 8601 in UTC. Flight times are entered and shown in each airport's local time (from its IANA time zone).

## AI usage

Every change that AI materially shaped is logged in [`AI_PROMPTS.txt`](AI_PROMPTS.txt), appended at the end, in the format the file already uses.
