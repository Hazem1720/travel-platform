// TEMPORARY (test branch only, never merged): ITN-26 over HTTP with a real
// MongoDB and real flights.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;
const Y = new Date().getUTCFullYear() + 1;

withDatabase('ITN-26 live check', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let user: any;
  let itn: string;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);
  const login = async (email: string, password: string) => {
    const a = request.agent(server);
    await a.post('/api/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const register = async (email: string) => {
    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'TEST ' + email,
        email,
        password: 'User12345',
        acceptTerms: true,
      })
      .expect(201);
    return login(email, 'User12345');
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    users = app.get(getModelToken(User.name));
    await users.create({
      name: 'TEST Admin',
      email: 'admin@itn.test',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      role: 'admin',
      acceptedTermsAt: new Date(),
    });
    const admin = await login('admin@itn.test', 'Admin12345');
    const airline = (
      await admin
        .post('/api/airlines')
        .send({ name: 'TEST Itn Air', code: 'IT' })
        .expect(201)
    ).body._id;
    await admin
      .post('/api/admin/moderators')
      .send({
        name: 'TEST Mod',
        email: 'mod@itn.test',
        role: 'airline_moderator',
        providerId: airline,
        temporaryPassword: 'Temp12345',
      })
      .expect(201);
    const mod = await login('mod@itn.test', 'Temp12345');
    await mod
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' })
      .expect(200);
    const flight = async (
      n: string,
      from: string,
      to: string,
      dep: string,
      arr: string,
      price: number,
    ) => {
      const id = (
        await mod
          .post('/api/flights')
          .send({
            flightNumber: n,
            from,
            to,
            departureLocal: dep,
            arrivalLocal: arr,
          })
          .expect(201)
      ).body._id;
      await mod
        .post(`/api/flights/${id}/cabins`)
        .send({
          category: 'Economy',
          totalSeats: 5,
          price,
          freeBags: 1,
          maxKgPerBag: 23,
        })
        .expect(201);
      return id;
    };
    await flight(
      'IT101',
      'CAI',
      'DXB',
      `${Y}-12-01T14:30`,
      `${Y}-12-01T18:45`,
      25000,
    );
    await flight(
      'IT103',
      'CAI',
      'DXB',
      `${Y}-12-01T06:00`,
      `${Y}-12-01T10:15`,
      31000,
    );
    await flight(
      'IT105',
      'CAI',
      'DXB',
      `${Y}-12-02T06:00`,
      `${Y}-12-02T10:15`,
      20000,
    );
    await flight(
      'IT102',
      'DXB',
      'CAI',
      `${Y}-12-03T20:00`,
      `${Y}-12-03T21:30`,
      22000,
    );
    await flight(
      'IT109',
      'CAI',
      'LHR',
      `${Y}-12-01T09:00`,
      `${Y}-12-01T13:00`,
      40000,
    );

    user = await register('u@itn.test');
    itn = (
      await user
        .post('/api/itineraries')
        .send({
          title: 'TEST Dubai trip',
          countries: ['AE'],
          startDate: `${Y}-12-01`,
        })
        .expect(201)
    ).body._id;
    for (let i = 0; i < 3; i++) {
      await user
        .post(`/api/itineraries/${itn}/days`)
        .send({ cityId: 'dubai' })
        .expect(201);
    }
  }, 120_000);

  afterAll(async () => {
    console.log(`\nITN-26 LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('one way: flights to the first city on the start date', async () => {
    const r = await user
      .get(`/api/itineraries/${itn}/flights?origin=cai`)
      .expect(200);
    expect(r.body.search).toEqual({
      origin: 'CAI',
      cityId: 'dubai',
      destinations: ['DXB'],
      date: `${Y}-12-01`,
      roundTrip: false,
    });
    expect(r.body.data.map((f: any) => f.flightNumber)).toEqual([
      'IT103',
      'IT101',
    ]);
    expect(r.body.data[0].airline.code).toBe('IT');
    expect(r.body.returnFlights).toBeNull();
    // Same flights as the plain FLT-11 search.
    const plain = await request(server)
      .get(`/api/flights/search?from=CAI&to=DXB&date=${Y}-12-01`)
      .expect(200);
    expect(plain.body.data.map((f: any) => f._id)).toEqual(
      r.body.data.map((f: any) => f._id),
    );
    ok(
      'one way: CAI to every Dubai airport on the start date, same flights as GET /flights/search',
    );
  });

  it("round trip: return on the last day's date; dates, passengers and sort can be changed", async () => {
    const r = await user
      .get(`/api/itineraries/${itn}/flights?origin=CAI&roundTrip=true`)
      .expect(200);
    expect(r.body.search.returnDate).toBe(`${Y}-12-03`);
    expect(r.body.returnFlights.data.map((f: any) => f.flightNumber)).toEqual([
      'IT102',
    ]);

    const d = await user
      .get(
        `/api/itineraries/${itn}/flights?origin=CAI&date=${Y}-12-02&sort=price:desc&adults=2`,
      )
      .expect(200);
    expect(d.body.data.map((f: any) => f.flightNumber)).toEqual(['IT105']);
    expect(d.body.data[0].cabins[0].totalFare).toBe(40000);

    const none = await user
      .get(`/api/itineraries/${itn}/flights?origin=CAI&cabin=First`)
      .expect(200);
    expect(none.body).toMatchObject({ data: [], message: 'No flights found' });
    ok(
      'round trip on the last day; ?date, ?adults (total fare), ?sort and ?cabin work; empty says "No flights found"',
    );
  });

  it('errors: 400, 401, 404', async () => {
    await user.get(`/api/itineraries/${itn}/flights?origin=XXX`).expect(400);
    await user.get(`/api/itineraries/${itn}/flights?origin=CA1`).expect(400);
    await user.get(`/api/itineraries/${itn}/flights`).expect(400);
    await user
      .get(`/api/itineraries/${itn}/flights?origin=CAI&returnDate=${Y}-11-01`)
      .expect(400);
    await user
      .get(`/api/itineraries/${itn}/flights?origin=CAI&adults=1&infants=2`)
      .expect(400);
    await request(server)
      .get(`/api/itineraries/${itn}/flights?origin=CAI`)
      .expect(401);
    const other = await register('other@itn.test');
    await other.get(`/api/itineraries/${itn}/flights?origin=CAI`).expect(404);
    const empty = (
      await user
        .post('/api/itineraries')
        .send({
          title: 'TEST empty',
          countries: ['AE'],
          startDate: `${Y}-12-01`,
        })
        .expect(201)
    ).body._id;
    const e = await user
      .get(`/api/itineraries/${empty}/flights?origin=CAI`)
      .expect(400);
    expect(e.body.message).toMatch(/Add a day first/);
    ok(
      "unknown/badly formed origin, missing origin, return before outbound, too many infants 400; no session 401; another user's itinerary 404; no days 400",
    );
  });
});
