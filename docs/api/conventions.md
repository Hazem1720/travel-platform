# API and schema conventions

Sources of truth for requirements, in this order:
1. `OFFICIAL-requirements.xlsx` (the official requirements sheet) and `Project Description.pdf` (the project description), as given by the course, plus the official datasets (`Mock Data.xlsx`). Each member keeps them in `docs/requirements/`; they are not committed yet (see `docs/requirements/README.md`).
2. `docs/requirements/requirements-tracker.csv` / `.xlsx`: the team's copy with owners and status. Its requirement text must match the official sheet word for word.

Where this file or the tracker differs from the official sheet, the official sheet wins. Everything below is decided; see the decision record at the end.

## General
- API prefix `/api`. Swagger at `/api/docs`.
- Error format: `{ statusCode, error, message, details?, path, timestamp }`. Validation errors use `message: "Validation failed"` and `details: { field: [messages] }`, with dotted paths for nested fields (GEN-02). Mongoose validation and cast errors are 400, duplicate keys 409.
- Lists: `?page=1&limit=10&sort=field:asc`, page size 10 (GEN-05): `limit` defaults to 10 and may not exceed 10. Response: `{ data, meta: { page, limit, total, totalPages } }`. Use `PaginationQueryDto` and `paginated()` from `common/pagination`.
- Dates: ISO 8601 in UTC. Flight times are entered in each airport's local time, stored in UTC, and shown in local time (FLT-03, GEN-06).
- Ids: MongoDB ObjectIds as strings, except reference data (see below).
- Money (PAY-04): the platform currency is **USD**, in the backend setting `PLATFORM_CURRENCY`. All prices, Stripe PaymentIntents, payments and refunds use it, and Payment and Refund records store it. Store amounts in the smallest unit (cents).
- Supported currencies (GEN-12, ITN-18): the currencies of the official countries dataset, `SUPPORTED_CURRENCIES` in `common/constants/currencies.ts`. Validate every currency field with `@IsSupportedCurrency()`.
- Exchange rates (ITN-18): from FXRatesAPI, fetched once per day and cached in the database; the last cached rates are used if the API is down. Show the date of the rate used, and convert to the user's preferred currency.
- Uploads (GEN-08): JPG or PNG, 5 MB maximum, up to 5 images per post, activity or hotel, 1 logo per airline. Images are stored on the server and served by URL. Use the shared upload utility.
- Backend validation and authorization always apply (GEN-13). Passwords are salted hashes.

## Auth and users
- Roles: `user`, `admin`, `airline_moderator`, `hotel_moderator`. Statuses: `active`, `suspended`, `deactivated`.
- Cookies (ACC-19): `access_token` (15 minutes) and `refresh_token` (rotating, path `/api/auth`), both httpOnly, Secure and SameSite=Lax. `COOKIE_SECURE=false` is for local development only and is refused in production. The current user comes from `GET /api/auth/me`.
- Sessions (ACC-06): 30 minutes without an authenticated request ends the session (`lastActivityAt`, checked by the guard and by refresh). Access tokens carry the user's `sessionVersion`; logout, password change and deactivation increment it, which revokes every access token already issued and clears the refresh token.
- Login (ACC-04, ACC-05): generic "Invalid email or password"; "Account is suspended" for suspended accounts; after 5 consecutive failures (`failedLoginAttempts`, incremented atomically) the account is locked for 15 minutes (`lockUntil`, HTTP 423). A successful login resets the counter.
- Guards (GEN-13): `JwtAuthGuard` and `RolesGuard` are global, so every route needs a session by default. Mark guest routes with `@Public()` (for example search and public content) and add them to the allowlist in `src/auth/route-guards.spec.ts`. Restrict by role with `@Roles()`; read the user with `@CurrentUser()`. Moderators: `assertOwnsProvider()` on every provider route.
- Ownership (ACC-11): only the owner reads or changes their bookings and private itineraries. Admins can read every booking; moderators can read bookings for their own airline or hotel. Anyone else gets **404** for another user's booking or private itinerary, so its existence is not revealed.
- Moderators (ACC-13): `assignedProviderId` links a moderator to exactly one airline or hotel; the provider type follows from the role.
- Temporary passwords (ACC-07a, ACC-13): store the hash of the temporary password, set `mustChangePassword: true`, clear `refreshTokenHash` and increment `sessionVersion`.
- Deactivation (ACC-12): refused while the user has upcoming Confirmed bookings. Afterwards their posts and public itineraries are hidden, and their comments and reviews show "Deleted user".
- Password rule: at least 8 characters with at least one letter and one digit.

## Reference data (loaded by the seed, see backend/seed-data)
- Text ids: country `EG`, city `cairo`, airport `CAI` (IATA code), attraction `att-1`.
- Flights reference airports by IATA code. Itineraries reference countries by country code and day cities by city id.
- Collections: `countries`, `cities`, `airports`, `attractions`. Airports have an IANA `timeZone`. Inject the models with `@InjectModel(Airport.name)`. `ReferenceModule` is global.

## Providers (airlines and hotels)
- Active flag (ACC-15, FLT-11, HTL-11): `isActive` on Airline and Hotel. Search and new bookings show only active providers; existing Confirmed bookings stay valid when a provider is deactivated.
- Cancellation tiers (FLT-09, HTL-10): `cancellationTiers[{ daysBefore, refundPercent }]`. `daysBefore` is a unique integer of at least 0 within a provider; `refundPercent` is 0-100.

## Flights (FLT)
- Flight status: `Scheduled`, `Cancelled`, `Departed` (FLT-30). Only Scheduled flights are searchable, editable or bookable.
- Cabins are embedded in the Flight document, from the fixed set Economy, Premium Economy, Business, First, each at most once per flight: `cabins[{ _id, category, totalSeats, bookedSeats, heldSeats, price, freeBags, maxKgPerBag }]`. One price per cabin (infants pay 10% and take no seat).
- Available seats = total - booked - held. Reserve seats with one atomic conditional update on the flight document.
- Airline: `name`, `code`, `logo`, `isActive`, `extraBagPrice` (above 0), `maxExtraBags` (at least 0), `cancellationTiers`.

## Bookings (flights and hotels)
- Statuses (GEN-11): `PendingPayment` (the 10-minute hold, with `expiresAt`), `Confirmed`, `Completed`, `Expired`, `Cancelled`. Only these transitions: PendingPayment to Confirmed or Expired, Confirmed to Completed or Cancelled.
- Booking reference (FLT-23, HTL-17): `FL-` (flights) or `HT-` (hotels) followed by 8 uppercase letters and digits, with a unique index.
- Price snapshot (FLT-05, HTL-05, HTL-16): at hold time a booking stores per-segment cabin fares, baggage fees, per-room nightly prices, the total and the currency. Later price changes never affect it.
- Hold expiry (FLT-06, FLT-22, HTL-18, PAY-01): a scheduled job runs every minute (`@nestjs/schedule`), and availability checks also treat `expiresAt < now` as expired, so a dead hold never blocks inventory between runs. Expiry sets the booking to Expired, releases `heldSeats` or deletes the room locks, and cancels the PaymentIntent. Cancelling a flight expires its PendingPayment bookings.

## Flight bookings
- A round trip is one booking with two segments, one payment and one reference.
- Passenger types: adult (12 and over), child (2 to 11), infant (under 2). At least one adult, no more infants than adults.
- Completed (FLT-25, ACC-12): a Confirmed flight booking becomes Completed after the arrival time of its last segment.

## Hotels (HTL)
- Room: unique name or number within the hotel, type, beds, `maxOccupancy`, `pricePerNight`, bookable date ranges, blocked ranges, active flag.
- Hotel: profile, star class, amenities, `isActive`, `checkInTime`, `checkOutTime`, `cancellationTiers`.
- Overlap safety (HTL-18, HTL-06): one lock document per room per night, with a unique index on `(roomId, date)` and a `kind` of `Held`, `Booked` or `Blocked`. A multi-room hold inserts all locks in one ordered insert; on a duplicate-key error the locks already inserted are removed, so the hold is all or nothing. Blocking dates creates `Blocked` locks, so it is rejected where Confirmed or PendingPayment reservations exist. Locks are deleted on expiry or cancellation.

## Hotel bookings
- All selected rooms are held together for 10 minutes. If any room conflicts, nothing is held (HTL-18).
- A Confirmed reservation becomes Completed after check-out.
- Ratings and reviews (HTL-23, HTL-24): one per Completed reservation; rating 1-5; review text up to 1000 characters; the author can edit or delete it; the hotel's average is recalculated each time. Reviews are listed newest first and paginated.

## Payments and refunds (PAY)
- Stripe test mode with PaymentIntents, in the platform currency (USD). Confirm bookings only after the webhook verifies success. Store only the Stripe payment id, amount, currency and status.
- Payment: `Pending`, `Succeeded`, `Failed`, `Expired`. Refund (Stripe Refunds API): `Pending`, `Refunded`, `Failed`.
- Policy acceptance is stored with a timestamp before payment.
- `PaymentsService`: `createPayment(type, bookingId)`, `confirmBooking(type, bookingId)`, `releaseInventory(type, bookingId)`, `refund(type, bookingId, amount)`. `type` is `flight` or `hotel`.
- Refund amount: pick the tier with the highest `daysBefore` not above the days remaining, else 0%. Provider cancellations refund 100%. "Days remaining" is counted in the airport's or hotel's local date. A refund record is created only when the amount is positive (PAY-03).
- Cancellation (FLT-12a, FLT-26, HTL-21): flights can be cancelled any time before departure; a round trip is cancelled as a whole using the outbound segment's tier. Hotel reservations can be cancelled only before the check-in date and only as a whole.

## Itineraries (ITN)
- Title up to 100 characters, at most 60 days, private by default. Day dates derive from the start date and order.
- Budget categories: food, accommodation, in-city transport, activities. Intercity transport entries are separate.

## Blog (BLG)
- Up to 5 tags per post (30 characters each), comments up to 500 characters, one like per user per post.
- Ordering (BLG-05, BLG-09): blog search orders by likes plus comments, then newest first. Comments are listed chronologically.

## Reports and hidden content (GEN-09, GEN-10)
- Posts, comments, reviews and itineraries share a `hidden` flag. Hidden content is visible only to its author and admins; every list query filters it.
- A user can report an item once (unique index on reporter and item).

## Shared services (owned by Hasan)
- `AuditService.log(...)` for admin actions, `NotificationsService.create(...)` for GEN-01 events, and the upload utility.

## Decision record
- 2026-11-08: the 17 audit proposals (P-1 to P-17, from `audit-report.md` findings IM-9 and MI-9) were approved by Mohamad Amr Khallaf as acting team lead and moved into the sections above. Ten of them restate official requirements (P-3, P-4, P-7, P-9, P-11 to P-16). The real choices: USD as platform currency (P-1), room-night lock documents (P-2), price snapshots (P-5), a per-minute expiry job with lazy checks (P-6), Completed after the last segment lands (P-8), 404 for other users' private resources (P-10) and the `FL-`/`HT-` booking reference (P-17).
