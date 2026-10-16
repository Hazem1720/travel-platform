\# API and schema conventions (DRAFT until the schema meeting)



\## General

\- API prefix `/api`. Swagger at `/api/docs`.

\- Error format: `{ statusCode, error, message, details?, path, timestamp }`.

\- Lists: `?page=1\&limit=10\&sort=field:asc`. Response: `{ data: \[...], meta: { page, limit, total, totalPages } }`.

\- Dates: ISO 8601 in UTC. Flights also store the airport time zone.

\- Ids: MongoDB ObjectIds, sent as strings.

\- Money: integer in the smallest unit (cents) plus a 3-letter currency code.



\## Roles and users

\- Roles: `user`, `admin`, `airline\_moderator`, `hotel\_moderator`.

\- Statuses: `active`, `suspended`, `deactivated`.

\- Moderators have `assignedProviderId`. Use `assertOwnsProvider()` on every moderator route.



\## Flights (proposal)

\- Cabins are embedded in the Flight document: `cabins\[{ \_id, cabinClass, totalSeats, availableSeats, prices: { adult, child, infant }, baggage }]`.

\- Seats are reserved with one atomic update on the flight document (conditional `$inc`).



\## Hotels (proposal)

\- One availability document per room per night: `{ roomId, date, status: available | blocked | booked, bookingId }`.

\- Unique index on `(roomId, date)`.



\## Booking and payment states (proposal)

\- Booking: `held` (flights only), `pending\_payment`, `confirmed`, `cancelled`, `expired`, `completed` (hotels).

\- Payment: `pending`, `succeeded`, `failed`, `expired`, `refunded`.

\- Holds carry `expiresAt`.



\## PaymentsService (proposal)

\- `createPayment(type, bookingId)`, `confirmBooking(type, bookingId)`, `releaseInventory(type, bookingId)`, `refund(type, bookingId, amount)`. `type` is `flight` or `hotel`.



\## Shared services (owned by Hasan)

\- `AuditService.log(...)`, `NotificationsService.create(...)`, and the upload utility.
## Reference data (loaded by the seed, see backend/seed-data)
- Ids are text, not ObjectIds: country `EG`, city `cairo`, airport `CAI` (IATA code), attraction `att-1`.
- Flight departure and arrival airports are IATA codes. Itinerary countries and day cities are country codes and city ids.
- Collections: `countries`, `cities`, `airports`, `attractions`. Airports have an optional `timeZone` (IANA name).
- Inject the models with `@InjectModel(Airport.name)`, and so on. `ReferenceModule` is global.
