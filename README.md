# Travel Planning and Booking Platform

GIU Software Project I, Winter 2026.

- Backend: NestJS + MongoDB Atlas (in `backend/`), Milestone 1
- Frontend: Next.js (in `frontend/`), Milestone 2
- Docs and requirements: `docs/` (the requirements tracker is in `docs/requirements/`)
- AI usage log: `AI_PROMPTS.txt`

## Run the backend locally

1. Install Node.js 20 or newer and Git.
2. Clone the repo and switch to `develop`:

        git clone https://github.com/Hazem1720/travel-platform.git
        cd travel-platform
        git checkout develop

3. Install the packages:

        cd backend
        npm install

4. Create `backend/.env` (copy `.env.example` from the repo root and fill it in). **Never commit this file.**

        NODE_ENV=development
        PORT=3000
        MONGODB_URI=<the team connection string, ask the team leader>
        JWT_SECRET=<your own long random text, 32 or more characters>
        FRONTEND_URL=http://localhost:3001
        JWT_EXPIRES_IN=15m
        COOKIE_SECURE=true
        SEED_ADMIN_EMAIL=<only if you run the admin seed>
        SEED_ADMIN_PASSWORD=<8+ characters with a letter and a digit>
        STRIPE_SECRET_KEY=<Stripe test-mode secret key>
        STRIPE_WEBHOOK_SECRET=<from the Stripe CLI or dashboard>
        FXRATES_API_KEY=<FXRatesAPI key>
        E2E_MONGODB_URI=<optional throwaway database for npm run test:e2e>

   The server checks these at startup and stops with a message if `MONGODB_URI`, `JWT_SECRET` or `FRONTEND_URL` is missing or invalid. Keep `COOKIE_SECURE=true`; set it to `false` only if your browser drops cookies on `http://localhost` (for example Safari). It is refused when `NODE_ENV=production`.

   Generate a secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

5. Start the server:

        npm run start:dev

6. Open Swagger: http://localhost:3000/api/docs

### MongoDB connection problem (`querySrv ECONNREFUSED`)

Some networks block the DNS lookup used by `mongodb+srv://` strings. In MongoDB Atlas, open Connect, then Drivers, switch on **Legacy URI String**, copy that `mongodb://` string into your own `.env`, and add `/travel-platform` before the `?`.

### Seed the database

The server loads the reference data by itself every time it starts (GEN-12): the official countries, cities, airports and attractions in `backend/seed-data`, and the supported currencies. Set `SEED_REFERENCE_ON_START=false` to turn this off. The admin account is created once by hand:

        npm run seed:admin

`npm run seed:reference` does the same reference load on demand and prints what it wrote. It checks every file first and writes nothing if a record is invalid. It is safe to run again. Add `-- --prune` to also delete records that are no longer in the files.

`seed:admin` needs `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `backend/.env`. The password must follow the account rule (at least 8 characters, a letter and a digit). Running it again never changes an existing admin's password unless you add `-- --reset-password`.

### Test payments locally (PAY-01, Stripe test mode)

Without the Stripe keys the server still starts; only paying answers 503.

1. In the Stripe dashboard, in a **sandbox** (test mode), open Developers, then API keys, and copy the secret key into `STRIPE_SECRET_KEY`. It must start with `sk_test_`: the server refuses live keys.
2. Install the Stripe CLI (`winget install Stripe.StripeCli` on Windows) and run `stripe login`, choosing the same sandbox.
3. Run `stripe listen --print-secret` and put the `whsec_...` it prints in `STRIPE_WEBHOOK_SECRET`. Restart the server.
4. Keep this running while you test, so Stripe's events reach your server:

        stripe listen --forward-to localhost:3000/api/payments/webhook

5. Hold a booking, accept its policies, then call `POST /api/bookings/{type}/{id}/pay`. The `clientSecret` it returns starts with the PaymentIntent id (`pi_..._secret_...`). Without a frontend, pay it from the CLI with a test card:

        stripe payment_intents confirm pi_... --payment-method pm_card_visa

   Use `pm_card_chargeDeclined` to see a declined card. The booking becomes Confirmed only when the webhook arrives.

6. Refunds (PAY-03) are made by `PaymentsService.refund()` when a booking is cancelled, and their status arrives through the same webhook. Pay with `pm_card_refundFail` to see a refund that the bank rejects later (Refunded, then Failed).

## Git workflow

- `main`: stable milestone versions. `develop`: integration branch.
- Never push directly to `main` or `develop`.
- Create a branch from the latest `develop`: `feature/<REQ-ID>-description` (for example `feature/FLT-22-seat-hold`).
- Commit messages: `feat(flights): add round-trip search`, `fix(hotels): prevent double booking`.
- Open a pull request to `develop`. Title: `[REQ-ID] Short title`. Put `Closes #<issue number>` in the description and explain how to test it in Swagger.
- The team leader reviews and approves every PR.
- Never commit `.env`, connection strings or API keys.

## Project structure (backend)

        backend/src/
          common/       shared enums, decorators, helpers, pagination, error filter
          auth/         authentication, guards (JwtAuthGuard, RolesGuard)
          users/        user schema and profile
          reference/    countries, cities, airports, attractions
          seed/         seed scripts
          ...           one feature folder per module (airlines, flights, hotels, payments, ...)

## Using the guards in your module

        @ApiCookieAuth('access_token')
        @UseGuards(JwtAuthGuard, RolesGuard)
        @Roles(Role.AIRLINE_MODERATOR)
        @Post()
        create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto) { ... }

Use `assertOwnsProvider(user, Role.AIRLINE_MODERATOR, airlineId)` so a moderator manages only their own airline or hotel.

## API conventions

The full list is in `docs/api/conventions.md`. In short:

- Prefix `/api`. Errors: `{ statusCode, error, message, details?, path, timestamp }`.
- Lists: `?page=1&limit=10&sort=field:asc`. Use `PaginationQueryDto` and `paginated()` from `common/pagination`.
- Dates are ISO 8601 in UTC. One platform currency for all prices, stored in the smallest unit.

## AI usage

Every important AI prompt must be logged in `AI_PROMPTS.txt` (append at the end only).