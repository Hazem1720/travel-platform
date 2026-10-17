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

        PORT=3000
        MONGODB_URI=<the team connection string, ask the team leader>
        JWT_SECRET=<your own long random text, 32 or more characters>
        JWT_EXPIRES_IN=15m
        COOKIE_SECURE=false
        FRONTEND_URL=http://localhost:3001

   Generate a secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

5. Start the server:

        npm run start:dev

6. Open Swagger: http://localhost:3000/api/docs

### MongoDB connection problem (`querySrv ECONNREFUSED`)

Some networks block the DNS lookup used by `mongodb+srv://` strings. In MongoDB Atlas, open Connect, then Drivers, switch on **Legacy URI String**, copy that `mongodb://` string into your own `.env`, and add `/travel-platform` before the `?`.

### Seed the database (only needed once for the shared database)

        npx ts-node src/seed/seed-reference.ts
        npx ts-node src/seed/seed-admin.ts

The admin seed needs `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in your local `.env`.

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