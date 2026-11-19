// Keys that must never appear in any API response body, at any depth.
// Exact names, not prefixes, so a field like "refreshedAt" never matches.
// The stored secrets are the ones in users/schemas/user.schema.ts.
export const SENSITIVE_KEYS: readonly string[] = [
  // user.schema.ts:17, 49, 68, 76
  'passwordHash',
  'refreshTokenHash',
  'emailVerificationTokenHash',
  'passwordResetTokenHash',
  // Plain secrets that only travel in cookies or emails.
  'password',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  // PAY-01: card data is never stored or returned.
  'cardNumber',
  'cvc',
  'cvv',
];

export interface SensitiveFinding {
  key: string;
  // Where in the body, for example "items[0].owner.passwordHash".
  path: string;
}

const KEYS = new Set(SENSITIVE_KEYS);

// The shared error format (common/filters, conventions.md) keys validation
// errors by field name: { "details": { "password": ["password must ..."] } }.
// Those keys are field names, not secrets, so they are not matched; their
// values are still scanned.
const isErrorBody = (v: unknown): v is { details: unknown } =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as any).statusCode === 'number' &&
  'details' in (v as object);

export function findSensitiveKeys(body: unknown): SensitiveFinding[] {
  const found: SensitiveFinding[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, path: string, fieldNames = false) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    const errorBody = path === '' && isErrorBody(value);
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (!fieldNames && KEYS.has(key)) found.push({ key, path: here });
      walk(v, here, errorBody && key === 'details');
    }
  };
  walk(body, '');
  return found;
}
