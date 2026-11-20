// Routes that do not yet meet the route gate (E2E_PLAN.md section 2.2:
// a 2xx hit, a 401 hit unless public, a 403 hit if it has @Roles, and a
// Swagger entry), with the reason. Each suite PR removes the routes it
// covers. The gate fails on an entry that is no longer needed, so this list
// only shrinks. Keys are "METHOD /api/path" as Express serves them.
export const ROUTE_EXCLUSIONS: Record<string, string> = {};
