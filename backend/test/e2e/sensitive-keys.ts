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

// The one exception: a validation error. The validation pipe
// (common/pipes/validation.pipe.ts:33-38) and the filter's Mongoose branch
// (common/filters/all-exceptions.filter.ts:47-57) answer
//   { statusCode: 400, error: 'Bad Request', message: 'Validation failed',
//     details: { <field name>: [<message>, ...] } }
// There, a key of "details" is the name of the field that failed (for
// example "password"), not a secret. The skip applies only when the whole
// body has exactly that shape:
//   - top level (not nested in another object);
//   - statusCode 400, error "Bad Request", message "Validation failed";
//   - details is a plain object, and every value is an array of strings.
// Only the keys directly under "details" are skipped. Any other body with a
// "details" object (another status or message, a value that is not a list
// of strings, a nested object) is scanned like any other.
export function isValidationErrorBody(
  body: unknown,
): body is { details: Record<string, string[]> } {
  if (!isPlainObject(body)) return false;
  const b = body as Record<string, unknown>;
  return (
    b.statusCode === 400 &&
    b.error === 'Bad Request' &&
    b.message === 'Validation failed' &&
    isPlainObject(b.details) &&
    Object.values(b.details as object).every(
      (v) => Array.isArray(v) && v.every((m) => typeof m === 'string'),
    )
  );
}

function isPlainObject(v: unknown): v is object {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function findSensitiveKeys(body: unknown): SensitiveFinding[] {
  const found: SensitiveFinding[] = [];
  const seen = new Set<unknown>();
  const fieldNames = isValidationErrorBody(body) ? body.details : null;
  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (value !== fieldNames && KEYS.has(key)) {
        found.push({ key, path: here });
      }
      walk(v, here);
    }
  };
  walk(body, '');
  return found;
}
