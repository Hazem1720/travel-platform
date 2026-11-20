import {
  ArgumentMetadata,
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

// GEN-13: every request body is a DTO object. A JSON array would otherwise
// reach the services as an array of DTOs (a 500, or a no-op edit answered 200).
export const BODY_NOT_OBJECT = 'The request body must be a JSON object';

class AppValidationPipe extends ValidationPipe {
  override async transform(value: unknown, metadata: ArgumentMetadata) {
    if (
      metadata.type === 'body' &&
      Array.isArray(value) &&
      metadata.metatype &&
      metadata.metatype !== Array
    ) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { body: [BODY_NOT_OBJECT] },
      });
    }
    return super.transform(value, metadata);
  }
}

export function createValidationPipe() {
  return new AppValidationPipe({
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
