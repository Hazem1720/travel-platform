# Backend test plan: real end-to-end tests

## Context
- **Today:** the backend has **107 unit specs** (`backend/src/**/*.spec.ts`). They use mocked models, so they never run a real query, index, guard chain or HTTP request. Only 2 files touch a real database, `test/app.e2e-spec.ts` and `test/flight-hold.e2e-spec.ts`. Their database tests are skipped unless `E2E_MONGODB_URI` is set (the pipeline and Swagger checks in `app.e2e-spec.ts` run on a fake connection), and CI runs only `npm test`.
- **Goal:** every backend requirement and every route is checked over **real HTTP → real guards, pipes and filters → real MongoDB**, on every PR. That is **106 Milestone 1 requirements** (95 mandatory and 11 bonus) in `docs/requirements/requirements-tracker.csv`, and **150 routes**, counted from Nest's router. A text search for route decorators finds only 148, because `blog.controller.ts:118,221` registers 2 POST routes through an alias (`HttpPost`).
- **Decisions so far:**
  - in-memory MongoDB;
  - an agent (Claude Code) writes the suites;
  - Memo reviews and merges every PR; nothing waits on anyone else.

Because an agent writes the tests largely unattended, section 0 sets rules it must follow. Sections 2 and 3 are gates that do not depend on anyone reading every line.

## 0. Rules for the agent (binding)
1. **Assertions come from the spec, not the code.** The source is the official Excel sheet and the tracker's Requirement text, plus `docs/api/conventions.md`. When the code disagrees:
   - write `it.failing('… (bug #n)')` with the **spec's** expected result;
   - open an issue `[REQ-ID] bug: …` with the label `e2e-found`;
   - never weaken an assertion to match the code.

   When the spec says nothing, the agent does not choose. It opens an issue labelled `spec-question`, for example "ACC-16 says suspended users cannot log in, but does not say their open sessions end", writes **no assertion** for that point, and keeps that REQ-ID in `requirement-exclusions.ts` with the reason `spec question #n`. It then carries on with the rest of the suite. The question is also listed in the PR.
2. **Test PRs never touch `backend/src/`.** If the harness needs a source change, the agent stops and asks Memo; if he agrees, it goes in its own small PR that Memo reviews first. The plan below needs none: the idle timeout is tested by moving `lastActivityAt` back (`jwt-auth.guard.ts:65-76`), and the scheduler is stopped with `SchedulerRegistry`. The mutation check (section 5) edits `src/` only locally and reverts it; before every commit the agent runs `git diff --exit-code -- backend/src`.
3. **No cheats.** The lint rules in section 4 reject `.skip`, `.only`, tests without `expect`, and loose matchers on status or body.
4. **The agent never merges.** It opens each PR and fills in the summary (section 5). So that it does not have to wait for a merge, the PRs are **stacked**:
   - PR 1 (`test/e2e-harness`) branches from `develop` and targets `develop`;
   - each suite branch is created from the previous test branch, and its PR targets that branch;
   - when Memo merges a PR and deletes its branch, GitHub retargets the next PR automatically.

   If review asks for a change to a lower PR, the agent commits it there and then **merges** that branch into each branch above it, in order. It never rebases a pushed branch, because that would need a force-push, and CLAUDE.md forbids force-pushing. PRs are merged with merge commits, so a merged parent retargets cleanly without a rebase.
5. **Fixing a source bug is the owner's work,** in a separate `fix/` PR, never part of a test PR.

## 1. Harness (PR 1)
Lives in `backend/test/e2e/`.

**Database and safety**
- **One entry point, `test/e2e/run.ts`** (`npm run test:e2e:full`, also used by CI). It creates a unique run folder with `fs.mkdtemp(os.tmpdir()/travel-e2e-)`, sets `E2E_RUN_DIR`, spawns Jest with the flags in section 4, then runs `check-coverage.ts` with the **same** `E2E_RUN_DIR`, and deletes the folder only after the check. It exits with Jest's code if Jest failed, otherwise with the check's code. This matters because the check runs in a separate process after Jest, and could not otherwise find the hit files. `global-teardown.ts` never deletes a run folder made by `run.ts`; it deletes only the folder `global-setup.ts` made itself for a plain run.
- `global-setup.ts` uses `E2E_RUN_DIR` when it is set, and otherwise creates its own folder the same way (for a plain `npm run test:e2e` of one suite, where no check runs). It then starts a `MongoMemoryServer`, pinned with `MONGOMS_VERSION` to the Atlas major version, and exports the URI. Workers inherit `process.env` from global setup, which is the mongodb-memory-server Jest pattern.
- A **single node is enough.** The code uses no Mongo transactions: `startSession` in `auth.service.ts:121` is the login cookie session, not `ClientSession`. A replica set only adds start-up time. The suite would fail loudly if that changed.
- **URI guard** in `setup-e2e-env.ts`. It throws when:
  - there is no URI;
  - the URI's host and database match `MONGODB_URI` in `backend/.env`, the shared database (checked first, and refused even with `E2E_ALLOW_ATLAS=1`);
  - any host in the URI is not `127.0.0.1` or `localhost` (an allow-list), unless `E2E_ALLOW_ATLAS=1` is set. This covers every form: `mongodb+srv://`, a standard `mongodb://` Atlas address with several hosts, an IP, another hostname.

  So no test reaches another machine unless `E2E_ALLOW_ATLAS=1` is set on purpose, and none ever reaches the shared database. (With the flag, another database on the same cluster is allowed; that is the throwaway Atlas check in section 4.)
- `createTestApp(suite)` gives each suite its own database named `e2e-<suite>-<uuid>`. `close()` drops only that database, and refuses any name without the `e2e-` prefix.
- **Indexes:** after `app.init()`, wait for `conn.model(n).init()` on every model before the first test. A self-test then checks with `listIndexes` that the unique `{roomId, date}` index (`room-lock.schema.ts:59`) and the unique seat-assignment indexes (`seat-assignment.schema.ts:39-46`) exist. Seat counts on a flight have no index; they rely on conditional updates.

**App**
- `createNestApplication({ rawBody: true })`. The existing `createApp` leaves `rawBody` out, so the webhook could not be tested. Then `configureApp()`.
- **Scheduler off:** after init, `SchedulerRegistry` stops every cron, interval and timeout, so jobs run only when a test calls them through `app.get(...)`.
- **Network blocked:** `nock` 14 (which intercepts Node's `fetch`) runs `disableNetConnect()` and allows only localhost. The Mongo driver uses raw sockets, so it is not affected.
- **Recorder:** an Express middleware added in `createTestApp`, before Nest's routes, listens to `res.on('finish')`. It records `METHOD req.route.path → status` for every response, **including the 401 and 403 that guards return** (an interceptor would miss those). It also wraps `res.json` to scan every response body, at any depth, for sensitive keys. The keys are an **exact list** in `test/e2e/sensitive-keys.ts` (the stored secrets `passwordHash`, `refreshTokenHash`, `emailVerificationTokenHash`, `passwordResetTokenHash` from `user.schema.ts:17,49,68,76`, plus `password`, `accessToken`, `refreshToken`, `cardNumber`, `cvc` and others), not prefixes, so a field like `refreshedAt` does not trip it. A match is written to the hit file and fails the check. One exception: in the shared error format, the keys of `details` are the names of the fields that failed validation (`details.password: ["password must ..."]`), so they are not matched; their values still are. Results go to `E2E_RUN_DIR/hits-<pid>.jsonl`.
- **Route list:** on boot, `createTestApp` writes `E2E_RUN_DIR/routes-<pid>.json` from Nest's Express router stack, one file per worker process (renaming over a file another process writes fails on Windows); the check requires all copies to match. Each entry has the method, the path, whether it is public (the same public marker the auth guard reads), its `@Roles` and whether it appears in the Swagger document. Every boot writes the same content, so it does not matter which suite runs first.

**Fakes**
- **FakeStripeGateway** extends the real gateway and overrides only `createIntent`, `cancelIntent` and `createRefund`, honouring idempotency keys. `verifyEvent` stays real. `signedWebhook()` signs with `Stripe.webhooks.generateTestHeaderString`.
- **Email:** an outbox fake captures the links in emails.
- **FX rates:** `nock` fakes FXRatesAPI at the HTTP level. The rates are not seeded into the database, so the real client code runs.

**Helpers**
- `actors.ts` returns real logged-in `supertest.agent`s; admins and moderators are inserted directly.
- `fixtures.ts` builds `TEST …` data through `ReferenceSeedService`.

**Test style**
- **HTTP rule:** results are always checked over HTTP, and write routes also read back the stored document. Code reaches the database or services directly only to arrange data, to move times into the past, or to call cron jobs.
- **Order:** tests run with `--randomize --showSeed`, so each `it` sets up its own state. A flow that depends on earlier steps is one `it`.
- **Existing files:** the 2 existing files move onto the harness; their `describe.skip` switch goes away.

## 2. Gates (fail CI, generated, no hand-kept tables)
A script, `test/e2e/check-coverage.ts`, is run by `run.ts` after Jest. It reads Jest's `--json` output, the route lists and the hit files from `E2E_RUN_DIR`. The report also counts, per requirement, how many tests pass and how many are `it.failing`, so a requirement covered only by `it.failing` stands out.

1. **Requirement gate.** Every M1 ID in the tracker (where `Milestone` is `M1`) must appear in the title of at least one passing `it` or a documented `it.failing`. The only other way out is an entry in `requirement-exclusions.ts`, with a reason (for example "frontend only"). A name in a title does not prove the rule is tested, so reviewers check that in section 5.
2. **Route gate.** The route list comes from **Nest's Express router stack**, not Swagger.
   - Every route must have at least one 2xx hit, or appear in `route-exclusions.ts` with a reason.
   - Every **non-public** route must also have a 401 hit, and every `@Roles` route a 403 hit. Public routes need no 401.
   - A route missing from the Swagger document also fails, which checks the Swagger documentation rule of the project description in the other direction. (IM-12, the label in the old `app.e2e-spec.ts`, is not a tracker ID, so the requirement gate cannot use it.) A route hidden from Swagger on purpose is listed in `route-exclusions.ts` with that reason.
3. **Sensitive-field gate:** any body flagged by the recorder fails the run.
4. **Output:** the script writes `coverage/e2e-coverage.md`, with one table of requirements and one of routes, and uploads it as a CI artifact.

## 3. Suites (each `it()` title names its REQ-IDs)
**P0**
1. **`access-control`**
   - Guard sweep over the router list:
     - every non-public route answers 401;
     - every `@Roles` route answers 403 to a traveler.
     - Guards run before pipes, so dummy IDs are enough.
   - **Public routes show nothing private.** A guest and another user each see:
     - published posts, but never drafts or hidden posts;
     - public itineraries, but never private ones (404);
     - hidden reviews and comments never appear.
   - A table of every `:id` route on bookings and itineraries. It fails when a router route is missing, and each entry is checked as user B (404).
   - Security on every create or update DTO:
     - extra fields such as `role`, `assignedProviderId` or `status` are rejected or have no effect;
     - `{"email":{"$gt":""}}` sent to login and search answers 400.
2. **`auth`** (ACC-01…07, ACC-19):
   - registering with a duplicate email answers 409;
   - cookies are `HttpOnly` and `SameSite=Lax` (`auth.service.ts:106`), and `Secure` when `COOKIE_SECURE` is not `false`;
   - refresh works, and logout revokes the session;
   - 5 failed logins lock the account, which unlocks after 15 minutes;
   - after 30 idle minutes (`lastActivityAt` moved back), both `/me` and refresh answer 401;
   - a reset link works once, expires after 30 minutes, and a newer request makes it invalid;
   - the answer to "forgot password" is the same for unknown emails.
3. **`flight-booking`**:
   - search dates follow each airport's time zone (New York, London);
   - quote and hold in cents; 20 parallel holds on the last seats give exactly N winners;
   - an expired hold releases its seats;
   - seat selection;
   - pay, then a signed webhook gives Confirmed and an `FL-` reference;
   - cancelling a confirmed booking returns the seats (`bookedSeats` goes down);
   - the right refund tier;
   - a flight change;
   - the e-ticket PDF;
   - the Completed job.
4. **`hotel-booking`**:
   - moderator CRUD and scoping (`assertOwnsProvider`);
   - search filters;
   - a race for overlapping nights gives one winner;
   - an expired hold frees its nights;
   - pay, then a webhook gives Confirmed;
   - cancelling a confirmed booking frees the nights;
   - cancellation tiers;
   - reviews only after a stay, and replies.
5. **`payments`** (PAY-01…04):
   - the intent amount equals the total in cents;
   - one intent per booking;
   - a forged or unsigned webhook answers 400 and changes nothing;
   - a repeated webhook has no further effect;
   - paying another user's booking answers 404;
   - **timing races, for flights and hotels:**
     - a `succeeded` webhook that arrives after the hold expired leaves the booking not Confirmed. A full Refund is created (`payments.service.ts:393-399`) and the inventory stays free.
     - The webhook and `releaseExpiredHolds` run in parallel (`Promise.all`, 20 times). Each time, exactly one of two outcomes holds: Confirmed with the inventory booked, or Expired with a full refund. Never both, and never neither.
   - a webhook whose amount differs from the booking does not confirm it (`:377`);
   - **money:** refund tiers on totals that do not divide evenly, for example 33333 cents at 50%. The code rounds with `Math.round` (`cancellation-tiers.ts:120`). The test pins the rule given in the Excel sheet; if the sheet gives none, it becomes a spec question (rule 0.1) for Memo, not a choice made in code.

**P1**
6. **`itineraries`**:
   - adding, deleting or reordering days renumbers them and moves the dates;
   - city grouping and the budget summary update;
   - private itineraries answer 404 to everyone else;
   - a clone (ITN-21) is a separate private copy with new IDs and `clonedFrom` credit. Editing it leaves the original unchanged, and deleting the original keeps the clone;
   - the PDF;
   - linking bookings.
7. **`providers`**: airlines, airports, flights, flight-edit rules, and the scoping of each moderator to their own provider.
8. **`exchange-rates`** (`nock`):
   - a successful fetch gives correct conversions;
   - a 500 or a timeout falls back to cached rates marked stale. After a failed fetch the client waits 10 minutes before trying again (`RETRY_AFTER_MS`, `exchange-rates.service.ts:4`), so each FX case uses a fresh app;
   - with no cache, the answer is 503;
   - an unknown currency code answers 400;
   - the API key never appears in any response.
9. **`uploads`**:
   - a real JPG and PNG are accepted;
   - a renamed `.exe` and a file over 5 MB are rejected;
   - more than 5 images, or more than 1 airline logo, is rejected;
   - `../.env` answers 404.
10. **`admin`**:
    - suspending a user (ACC-16) means they cannot log in, their bookings stay valid, and their content stays visible;
    - reactivating them works;
    - the admin password reset works;
    - moderators are created through ACC-13;
    - analytics totals match the seeded bookings;
    - the admin bookings list (ACC-17);
    - **every** admin and moderation action writes an audit entry (GEN-07). The check is driven by a table of actions.
11. **`notifications`**: a table drives this suite, one row per `NotificationType` (`notification.schema.ts:5-15`): booking confirmed, booking cancelled, refund issued, flight schedule changed, account suspended, provider suspended, and the bonus review replied and booking changed. For each row: do the action, then check over HTTP that the right user has a notification of the right type, that the unread count went up, and that marking it read works. Only the owner can see it.

**P2**
- **`blog-community`**:
  - posts, tags and authors;
  - comments;
  - one like per user per post;
  - one report per user per item (GEN-09);
  - hiding content (GEN-10).
- **`favourites`**.
- **`pagination-errors`**: `page` and `limit` defaults and caps on every list route, and the shared error format.
- **`journey`**: one smoke test that runs a whole trip.

**Opt-in: `stripe-live`** (a separate Jest project, `npm run test:e2e:stripe`, not in CI):
- the real gateway with an `sk_test_` key: pay with `pm_card_visa`, then `pm_card_chargeDeclined`;
- the same intent comes back for the same booking (idempotency);
- a real refund;
- when a hold expires, its PaymentIntent is cancelled at Stripe;
- the real events are fetched with `stripe.events.list` and signed locally before being sent to our webhook.

Before each milestone, someone checks once by hand with `stripe listen --forward-to localhost:3000/api/payments/webhook`.

## 4. CI and lint
- **`ci.yml` e2e step:** `npm run test:e2e:full`. That runs `run.ts`, which calls `jest --config ./test/jest-e2e.json --randomize --showSeed --json --outputFile=coverage/e2e.json` and then `check-coverage.ts`, as in section 1.
  - `test/jest-e2e.json` gets `globalSetup`, `globalTeardown` and `testTimeout: 30000`.
  - The mongod binary is cached.
  - The coverage report is uploaded.
  - No secrets are needed.
  - Every PR runs the **whole** suite.
- **Lint:** `eslint-plugin-jest` for `test/**`, with these rules:
  - `no-disabled-tests`, `no-focused-tests` (no `.skip` or `.only`);
  - `expect-expect` (every test asserts something);
  - `no-standalone-expect`;
  - `no-restricted-properties` bans `expect.anything` and `no-restricted-syntax` bans `expect.any(Object)`, everywhere in `test/` (a lint rule cannot target only status and body). CI runs this lint read-only.
- **Atlas check:** before each milestone, one full run with `E2E_ALLOW_ATLAS=1` against a **separate throwaway** Atlas database. The result goes on the tracking issue.

## 5. Delivery and review
- **Order:**
  1. PR 1: the harness, gates, lint, CI and both exclusion files. All requirements start excluded with the reason "pending suite".
  2. Each suite PR removes its IDs from the exclusion list.
  3. Suites go in P0 → P2 order. The milestone is evaluated after the frontend is done, so correctness matters more than speed: a suite is finished only when its gate and mutation check pass.
- **Every PR description lists:**
  - the REQ-IDs it covers;
  - each new `it.failing` with its issue link;
  - questions about the spec;
  - the mutation-check result: remove one guard, an `assertOwner`, the signature check or a unique index, and show that the suite fails;
  - the module owners whose code it tests.
- **The bug workflow** follows rule 0.1. The fix PR turns `it.failing` into `it`, and Jest fails on any `it.failing` that starts passing.
- **Review is the real cost.** About 15 suites is a lot to read, and the team must defend these tests in the discussion. A reviewer reads the PR summary, the coverage report and every assertion in P0. P1 and P2 can be sampled.
- **Authorship must match git history.** Whoever runs the agent is the author of its commits. Memo authors with Claude Code, and reviews and merges, and the tracking issue, PRs and `AI_PROMPTS.txt` say so.
- **Each PR also updates:** the tracker's Test evidence column and `AI_PROMPTS.txt`. The CSV is edited; the xlsx is then updated from the CSV with the existing `scripts/sync-tracker-xlsx.py` (keeping its formatting), never edited by hand, so the two cannot disagree.
- **Branch prefix:** `test/e2e-<area>` (settled; CLAUDE.md lists no `test/` prefix, and this one is used).

## Verification (each PR)
1. `npm run build`, `npm test`, `npx eslint "{src,test}/**/*.ts"` (0 problems).
2. `npm run test:e2e:full` (the full e2e run plus `check-coverage.ts`), green apart from the documented exclusions.
3. `git diff --exit-code -- backend/src` is clean.
4. The mutation check is recorded in the PR.
5. CI passes. Then Memo merges with `--match-head-commit`.
