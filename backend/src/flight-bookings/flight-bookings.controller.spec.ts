import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApp } from '../app.setup';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightHoldService } from './flight-hold.service';
import { FlightQuoteService } from './flight-quote.service';

// POST /api/flight-bookings over HTTP (FLT-19, FLT-21). The login and role
// guards are global (AuthModule) and checked in route-guards.spec.ts.
describe('POST /api/flight-bookings (FLT-19, FLT-21)', () => {
  let app: INestApplication;
  const quote = jest.fn(async () => ({ price: { total: 42000 } }));

  const hold = jest.fn(async () => ({ status: 'PendingPayment' }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FlightBookingsController],
      providers: [
        { provide: FlightQuoteService, useValue: { quote } },
        { provide: FlightHoldService, useValue: { hold } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // What the global login guard sets in the real app.
    app.use((req: any, _res: unknown, next: () => void) => {
      req.user = { id: 'user-1', role: 'user' };
      next();
    });
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

  it('POST /hold answers 201 with the PendingPayment booking (FLT-22)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/flight-bookings/hold')
      .send(body)
      .expect(201);
    expect(res.body).toEqual({ status: 'PendingPayment' });
    expect(hold).toHaveBeenCalledWith('user-1', expect.objectContaining(body));
  });
});
