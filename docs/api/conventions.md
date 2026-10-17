# API and schema conventions (agreed at the schema meeting)

Source of truth for requirements: docs/requirements/requirements-tracker.xlsx (from the official Excel sheet).
Where this file and the Excel sheet differ, the Excel sheet wins.

## General
- API prefix `/api`. Swagger at `/api/docs`.
- Error format: `{ statusCode, error, message, details?, path, timestamp }`.
- Lists: `?page=1&limit=10&sort=field:asc`, default page size 10 (GEN-05). Response: `{ data, meta: { page, limit, total, totalPages } }`. Use `PaginationQueryDto` and `paginated()` from `common/pagination`.
- Dates: ISO 8601 in UTC. Flight times are entered in each airport's local time, stored in UTC, and shown in local time (FLT-03, GEN-06).
- Ids: MongoDB ObjectIds as strings, except reference data (see below).
- Money: one platform currency for all prices, payments and refunds (PAY-04). Store amounts in the smallest unit (cents). PROPOSAL: platform currency USD, to confirm at the meeting.
- Uploads: JPG or PNG, 5 MB maximum, up to 5 images per post, activity or hotel, 1 logo per airline (GEN-08). Use the shared upload utility.
- Backend validation and authorization always apply (GEN-13). Passwords are salted hashes.

## Auth and users
- Roles: `user`, `admin`, `airline_moderator`, `hotel_moderator`. Statuses: `active`, `suspended`, `deactivated`.
- Cookies: `access_token` (15 minutes) and `refresh_token` (rotating), both httpOnly. Session idle for 30 minutes expires (ACC-06, ACC-19).
- Guards: `JwtAuthGuard`, `RolesGuard` with `@Roles()`, `@CurrentUser()`. Moderators: `assertOwnsProvider()` on every provider route.
- Temporary passwords (ACC-07a, ACC-13): set `mustChangePassword: true`, `passwordHash` and `refreshTokenHash: null`.
- Password rule: at least 8 characters with at least one letter and one digit.

## Reference data (loaded by the seed, see backend/seed-data)
- Text ids: country `EG`, city `cairo`, airport `CAI` (IATA code), attraction `att-1`.
- Flights reference airports by IATA code. Itineraries reference countries by country code and day cities by city id.
- Collections: `countries`, `cities`, `airports`, `attractions`. Airports have an IANA `timeZone`. Inject the models with `@InjectModel(Airport.name)`. `ReferenceModule` is global.

## Flights (FLT)
- Flight status: `Scheduled`, `Cancelled`, `Departed` (FLT-30). Only Scheduled flights are searchable, editable or bookable.
- Cabins are embedded in the Flight document, from the fixed set Economy, Premium Economy, Business, First, each at most once per flight: `cabins[{ _id, category, totalSeats, bookedSeats, heldSeats, price, freeBags, maxKgPerBag }]`. One price per cabin (infants pay 10% and take no seat).
- Available seats = total - booked - held. Reserve seats with one atomic conditional update on the flight document.
- Airline: `name`, `code`, `logo`, `extraBagPrice`, `maxExtraBags`, `cancellationTiers[{ daysBefore, refundPercent }]`.

## Flight bookings
- Statuses (GEN-11): `PendingPayment` (the 10-minute hold, with `expiresAt`), `Confirmed`, `Completed`, `Expired`, `Cancelled`. Only these transitions: PendingPayment to Confirmed or Expired, Confirmed to Completed or Cancelled.
- A round trip is one booking with two segments, one payment and one reference.
- Passenger types: adult (12 and over), child (2 to 11), infant (under 2). At least one adult, no more infants than adults.

## Hotels (HTL)
- Room: unique name or number within the hotel, type, beds, `maxOccupancy`, `pricePerNight`, bookable date ranges, blocked ranges, active flag.
- Hotel: profile, star class, amenities, `checkInTime`, `checkOutTime`, `cancellationTiers[{ daysBefore, refundPercent }]`.
- PROPOSAL for overlap safety: one lock document per room per night with a unique index on `(roomId, date)`. Rawda and Memo confirm.

## Hotel bookings
- Same statuses as flight bookings. All selected rooms are held together for 10 minutes. If any room conflicts, nothing is held (HTL-18).
- A Confirmed reservation becomes Completed after check-out. Ratings: one per Completed reservation (HTL-23).

## Payments and refunds (PAY)
- Stripe test mode with PaymentIntents. Confirm bookings only after the webhook verifies success. Store only the Stripe payment id, amount, currency and status.
- Payment: `Pending`, `Succeeded`, `Failed`, `Expired`. Refund (Stripe Refunds API): `Pending`, `Refunded`, `Failed`.
- Policy acceptance is stored with a timestamp before payment.
- `PaymentsService`: `createPayment(type, bookingId)`, `confirmBooking(type, bookingId)`, `releaseInventory(type, bookingId)`, `refund(type, bookingId, amount)`. `type` is `flight` or `hotel`.
- Refund amount: pick the tier with the highest `daysBefore` not above the days remaining, else 0%. Provider cancellations refund 100%.

## Itineraries (ITN)
- Title up to 100 characters, at most 60 days, private by default. Day dates derive from the start date and order.
- Budget categories: food, accommodation, in-city transport, activities. Intercity transport entries are separate.
- Exchange rates: fetched once per day, cached in the database, last cached rates used if the API is down.

## Blog (BLG)
- Up to 5 tags per post (30 characters each), comments up to 500 characters, one like per user per post, ordering by likes plus comments, then newest first.

## Shared services (owned by Hasan)
- `AuditService.log(...)` for admin actions, `NotificationsService.create(...)` for GEN-01 events, and the upload utility.