import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  423: 'Locked',
  500: 'Internal Server Error',
};

export interface ApiErrorExample {
  status: number;
  message: string;
  details?: Record<string, string[]>;
  // Shown in Swagger when one status can mean several things.
  description?: string;
}

// Documents error responses in the shared format from AllExceptionsFilter.
export function ApiErrors(...errors: ApiErrorExample[]) {
  return applyDecorators(
    ...errors.map((e) =>
      ApiResponse({
        status: e.status,
        description: e.description ?? e.message,
        schema: {
          example: {
            statusCode: e.status,
            error: STATUS_TEXT[e.status] ?? 'Error',
            message: e.message,
            ...(e.details ? { details: e.details } : {}),
            path: '/api/...',
            timestamp: '2026-11-08T10:00:00.000Z',
          },
        },
      }),
    ),
  );
}

// Errors every protected route can return.
export const UNAUTHENTICATED: ApiErrorExample = {
  status: 401,
  message: 'Authentication required',
  description:
    'No session, an expired or revoked access token, or 30 minutes without activity (ACC-06)',
};
export const MUST_CHANGE_PASSWORD: ApiErrorExample = {
  status: 403,
  message: 'You must change your temporary password first',
  description: 'The account is suspended, or must change a temporary password (ACC-07a)',
};
