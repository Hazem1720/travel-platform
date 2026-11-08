import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

// Shared error format: { statusCode, error, message, details?, path, timestamp }.
// Validation details are keyed by field (GEN-02).
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception);
    }

    res.status(body.statusCode).json({
      ...body,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Mongoose schema validation (e.g. a value the DTO allowed but the schema rejects).
    if (exception instanceof MongooseError.ValidationError) {
      const details: Record<string, string[]> = {};
      for (const [path, err] of Object.entries(exception.errors)) {
        details[path] = [err.message];
      }
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: 'Validation failed',
        details,
      };
    }

    // An id or value of the wrong type, e.g. GET /items/not-an-object-id.
    if (exception instanceof MongooseError.CastError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: `Invalid value for "${exception.path}"`,
        details: {
          [exception.path]: [`"${String(exception.value)}" is not valid`],
        },
      };
    }

    // Unique index violation (MongoServerError code 11000).
    const mongo = exception as {
      code?: number;
      keyValue?: Record<string, unknown>;
    };
    if (mongo?.code === 11000) {
      const fields = Object.keys(mongo.keyValue ?? {});
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: fields.length
          ? `A record with this ${fields.join(', ')} already exists`
          : 'A record with these values already exists',
        details: Object.fromEntries(fields.map((f) => [f, ['must be unique']])),
      };
    }

    // Anything else: never leak internal messages or stack traces.
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
    };
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const statusCode = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return { statusCode, error: exception.name, message: body };
    }

    const b = body as Record<string, any>;
    const error = b.error ?? exception.name;
    if (b.details !== undefined) {
      return {
        statusCode,
        error,
        message: b.message ?? 'Request failed',
        details: b.details,
      };
    }
    // A plain array of messages (e.g. a ValidationPipe created elsewhere).
    if (Array.isArray(b.message)) {
      return {
        statusCode,
        error,
        message: 'Validation failed',
        details: { _: b.message },
      };
    }
    return { statusCode, error, message: b.message ?? exception.message };
  }
}
