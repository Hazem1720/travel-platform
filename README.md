# \# Travel Planning and Booking Platform

# 

# GIU Software Project I, Winter 2026.

# 

# \- Backend: NestJS + MongoDB Atlas (in `backend/`), Milestone 1

# \- Frontend: Next.js (in `frontend/`), Milestone 2

# \- Docs and requirements: `docs/`

# \- AI usage log: `AI\_PROMPTS.txt`

# 

# \## Run the backend locally

# 

# 1\. Install Node.js 20 or newer and Git.

# 2\. Clone the repo and switch to `develop`:

# 

# &#x20;       git clone https://github.com/Hazem1720/travel-platform.git

# &#x20;       cd travel-platform

# &#x20;       git checkout develop

# 

# 3\. Install the packages:

# 

# &#x20;       cd backend

# &#x20;       npm install

# 

# 4\. Create `backend/.env` (copy `.env.example` from the repo root and fill it in). \*\*Never commit this file.\*\*

# 

# &#x20;       PORT=3000

# &#x20;       MONGODB\_URI=<the team connection string, ask the team leader>

# &#x20;       JWT\_SECRET=<your own long random text, 32 or more characters>

# &#x20;       JWT\_EXPIRES\_IN=1d

# &#x20;       COOKIE\_SECURE=false

# &#x20;       FRONTEND\_URL=http://localhost:3001

# 

# &#x20;  Generate a secret with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

# 

# 5\. Start the server:

# 

# &#x20;       npm run start:dev

# 

# 6\. Open Swagger: http://localhost:3000/api/docs

# 

# \### MongoDB connection problem (`querySrv ECONNREFUSED`)

# 

# Some networks block the DNS lookup used by `mongodb+srv://` strings. In MongoDB Atlas, open Connect, then Drivers, switch on \*\*Legacy URI String\*\*, copy that `mongodb://` string into your own `.env`, and add `/travel-platform` before the `?`.

# 

# \## Git workflow

# 

# \- `main`: stable milestone versions. `develop`: integration branch.

# \- Never push directly to `main` or `develop`.

# \- Create a branch from the latest `develop`: `feature/<REQ-ID>-description` (for example `feature/FLT-22-seat-hold`).

# \- Commit messages: `feat(flights): add round-trip search`, `fix(hotels): prevent double booking`.

# \- Open a pull request to `develop`. Title: `\[REQ-ID] Short title`. Put `Closes #<issue number>` in the description and explain how to test it in Swagger.

# \- The team leader reviews and approves every PR.

# \- Never commit `.env`, connection strings or API keys.

# 

# \## Project structure (backend)

# 

# &#x20;   backend/src/

# &#x20;     common/       shared enums, decorators, helpers, error filter

# &#x20;     auth/         authentication, guards (JwtAuthGuard, RolesGuard)

# &#x20;     users/        user schema and profile

# &#x20;     ...           one feature folder per module (airlines, flights, hotels, payments, ...)

# 

# \## Using the guards in your module

# 

# &#x20;   @ApiCookieAuth('access\_token')

# &#x20;   @UseGuards(JwtAuthGuard, RolesGuard)

# &#x20;   @Roles(Role.AIRLINE\_MODERATOR)

# &#x20;   @Post()

# &#x20;   create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto) { ... }

# 

# Use `assertOwnsProvider(user, Role.AIRLINE\_MODERATOR, airlineId)` so a moderator manages only their own airline or hotel.

# 

# \## API conventions

# 

# \- Prefix `/api`. Errors: `{ statusCode, error, message, details?, path, timestamp }`.

# \- Lists: `?page=1\&limit=10\&sort=field:asc`.

# \- Dates are ISO 8601 in UTC. Money is stored in the smallest unit plus a currency code.

# 

# \## AI usage

# 

# Every important AI prompt must be logged in `AI\_PROMPTS.txt` (append at the end only).

