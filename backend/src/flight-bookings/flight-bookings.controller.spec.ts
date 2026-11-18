import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApp } from '../app.setup';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightQuoteService } from './flight-quote.service';

// POST /api/flight-bookings over HTTP (FLT-19, FLT-21). The login and role
// guards are global (AuthModule) and checked in route-guards.spec.ts.
describe('POST /api/flight-bookings (FLT-19, FLT-21)', () => {
  let app: INestApplication;
  const quote = jest.fn(async () => ({ price: { total: 42000 } }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FlightBookingsController],
      providers: [{ provide: FlightQuoteService, useValue: { quote } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(() => app?.close());
  beforeEach(() => quote.mockClear());

  const body = {
    outboundFlightId: '6737a1f4c1a2b3c4d5e6f101',
    cabin: 'Economy',
    passengers: [
      {
        type: 'adult',
        fullName: 'Sara Ali',
        dateOfBirth: '1990-01-01',
        passportNumber: 'A1234567',
      },
    ],
  };

  it('answers 200 with the summary: nothing is created', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/flight-bookings')
      .send(body)
      .expect(200);
    expect(res.body).toEqual({ price: { total: 42000 } });
    expect(quote).toHaveBeenCalledWith(expect.objectContaining(body));
  });

  it('names the wrong passenger field in the 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/flight-bookings')
      .send({
        ...body,
        passengers: [{ ...body.passengers[0], passportNumber: '!!' }],
      })
      .expect(400);
    expect(Object.keys(res.body.details)).toEqual([
      'passengers.0.passportNumber',
    ]);
    expect(quote).not.toHaveBeenCalled();
  });

  it('refuses a price or status sent by the client', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/flight-bookings')
      .send({ ...body, total: 1 })
      .expect(400);
    expect(res.body.details).toHaveProperty('total');
  });
});
