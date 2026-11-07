import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Error as MongooseError, Schema, model } from 'mongoose';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn();
  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ url: '/api/test' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());

  it('uses the shared error format', () => {
    const { status, body } = run(new NotFoundException('User not found'));
    expect(status).toBe(404);
    expect(body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'User not found',
      path: '/api/test',
      timestamp: expect.any(String),
    });
  });

  it('passes field-keyed validation details through (GEN-02)', () => {
    const { status, body } = run(
      new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { email: ['email must be an email'] },
      }),
    );
    expect(status).toBe(400);
    expect(body.details).toEqual({ email: ['email must be an email'] });
  });

  it('keeps custom status codes such as 423 Locked', () => {
    const { status, body } = run(new HttpException('Account temporarily locked.', 423));
    expect(status).toBe(423);
    expect(body.message).toBe('Account temporarily locked.');
  });

  it('maps a Mongoose ValidationError to 400 keyed by field (MI-3)', async () => {
    const Thing = model('FilterSpecThing', new Schema({ name: { type: String, required: true } }));
    const err = await new Thing({}).validate().catch((e) => e);
    expect(err).toBeInstanceOf(MongooseError.ValidationError);

    const { status, body } = run(err);
    expect(status).toBe(400);
    expect(body.message).toBe('Validation failed');
    expect(Object.keys(body.details)).toEqual(['name']);
  });

  it('maps a Mongoose CastError to 400 (MI-3)', () => {
    const err = new MongooseError.CastError('ObjectId', 'not-an-id', '_id');
    const { status, body } = run(err);
    expect(status).toBe(400);
    expect(body.message).toBe('Invalid value for "_id"');
  });

  it('maps a duplicate-key error to 409', () => {
    const { status, body } = run({ code: 11000, keyValue: { email: 'a@b.c' } });
    expect(status).toBe(409);
    expect(body.details).toEqual({ email: ['must be unique'] });
    expect(JSON.stringify(body)).not.toContain('a@b.c');
  });

  it('hides internal errors behind a generic 500', () => {
    const { status, body } = run(new Error('connection string mongodb://secret@host'));
    expect(status).toBe(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('still returns 409 for ConflictException', () => {
    expect(run(new ConflictException('Email is already registered')).status).toBe(409);
  });
});
