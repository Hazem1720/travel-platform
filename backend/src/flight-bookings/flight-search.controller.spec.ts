import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApp } from '../app.setup';
import { FlightSearchController } from './flight-search.controller';
import { FlightDetailsService } from './flight-details.service';
import { FlightSearchService } from './flight-search.service';

// FLT-11 over HTTP: the query string reaches the service already validated
// and converted. The service itself is tested in flight-search.service.spec.
describe('GET /api/flights/search (FLT-11)', () => {
  let app: INestApplication;
  const search = jest.fn(async () => ({
    data: [],
    meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
    message: 'No flights found',
  }));

  const details = jest.fn(async (id: string) => ({ _id: id }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FlightSearchController],
      providers: [
        { provide: FlightSearchService, useValue: { search } },
        { provide: FlightDetailsService, useValue: { details } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(() => app?.close());
  beforeEach(() => search.mockClear());

  it('passes a converted query to the service and returns 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/flights/search')
      .query({ from: 'cai', to: 'dxb', date: '2026-12-02', passengers: '2' })
      .expect(200);
    expect(res.body.message).toBe('No flights found');
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'CAI',
        to: 'DXB',
        date: '2026-12-02',
        passengers: 2,
        page: 1,
        limit: 10,
      }),
    );
  });

  it('answers 400 in the shared format for a bad query', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/flights/search')
      .query({ from: 'CAI', to: 'DXB', date: '2026-02-30' })
      .expect(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
      details: { date: ['date must be a real date'] },
      path: '/api/flights/search?from=CAI&to=DXB&date=2026-02-30',
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('requires from, to and date', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/flights/search')
      .expect(400);
    expect(Object.keys(res.body.details).sort()).toEqual([
      'date',
      'from',
      'to',
    ]);
  });

  it('GET /flights/search is not read as a flight id', async () => {
    await request(app.getHttpServer())
      .get('/api/flights/search')
      .query({ from: 'CAI', to: 'DXB', date: '2026-12-02' })
      .expect(200);
    expect(details).not.toHaveBeenCalled();
  });

  it('GET /flights/:id returns the details (FLT-17)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/flights/6736d4f4c1a2b3c4d5e6fa01')
      .expect(200);
    expect(res.body).toEqual({ _id: '6736d4f4c1a2b3c4d5e6fa01' });
    expect(details).toHaveBeenCalledWith('6736d4f4c1a2b3c4d5e6fa01');
  });
});
