import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

export type FieldErrors = Record<string, string[]>;

// GEN-02: validation errors keyed by field, so the frontend can show each
// message next to its input. Nested fields use dotted paths ("passengers.0.name").
export function toFieldErrors(
  errors: ValidationError[],
  parent = '',
): FieldErrors {
  const out: FieldErrors = {};
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) {
      out[path] = [...(out[path] ?? []), ...Object.values(e.constraints)];
    }
    if (e.children?.length) {
      Object.assign(out, toFieldErrors(e.children, path));
    }
  }
  return out;
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: toFieldErrors(errors),
      }),
  });
}
