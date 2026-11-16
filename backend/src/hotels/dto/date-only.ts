import { ValidateBy, ValidationOptions } from 'class-validator';

// "YYYY-MM-DD" that is also a real calendar date (2026-02-30 is not).
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

export function IsDateOnly(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isDateOnly',
      validator: {
        validate: (value: unknown) => isDateOnly(value),
        defaultMessage: (args) =>
          `${args?.property} must be a real date written as YYYY-MM-DD`,
      },
    },
    options,
  );
}
