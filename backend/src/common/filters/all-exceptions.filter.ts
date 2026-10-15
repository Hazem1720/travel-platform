import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message = 'Internal server error';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        error = exception.name;
      } else {
        const b = body as Record<string, any>;
        error = b.error ?? exception.name;
        if (Array.isArray(b.message)) {
          message = 'Validation failed';
          details = b.message;
        } else {
          message = b.message ?? message;
        }
      }
    } else {
      this.logger.error(exception);
    }

    res.status(statusCode).json({
      statusCode,
      error,
      message,
      details,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}