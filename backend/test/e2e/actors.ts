import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import * as request from 'supertest';
import { AccountStatus, Role } from '../../src/common/enums/role.enum';
import { User } from '../../src/users/schemas/user.schema';
import { TestApp } from './app';

export const TEST_PASSWORD = 'Passw0rd1';

export interface Actor {
  // Keeps the httpOnly cookies from POST /api/auth/login, like a browser.
  agent: ReturnType<typeof request.agent>;
  id: string;
  email: string;
  password: string;
}

export const testEmail = (who = 'user') =>
  `e2e-${who}-${randomUUID().slice(0, 8)}@example.test`;

// A traveler who registered through the API (ACC-01), opened the emailed
// verification link (ACC-02) and logged in (ACC-04).
export async function traveler(
  t: TestApp,
  name = 'TEST Traveler',
): Promise<Actor> {
  const email = testEmail('traveler');
  await t
    .http()
    .post('/api/auth/register')
    .send({ name, email, password: TEST_PASSWORD, acceptTerms: true })
    .expect(201);
  await t
    .http()
    .get('/api/auth/verify-email')
    .query({ token: t.outbox.token(email, 'verify-email') })
    .expect(200);
  return login(t, email, TEST_PASSWORD);
}

// Admins exist only through seeding (ACC-18) and moderators are created by
// an admin (ACC-13); suites that are not about those requirements insert
// the account directly (arrange), then log in over HTTP like anyone else.
export async function admin(t: TestApp): Promise<Actor> {
  return insertAndLogin(t, Role.ADMIN, null, 'TEST Admin');
}

export async function airlineModerator(
  t: TestApp,
  airlineId: Types.ObjectId | string,
): Promise<Actor> {
  return insertAndLogin(
    t,
    Role.AIRLINE_MODERATOR,
    airlineId,
    'TEST Airline Mod',
  );
}

export async function hotelModerator(
  t: TestApp,
  hotelId: Types.ObjectId | string,
): Promise<Actor> {
  return insertAndLogin(t, Role.HOTEL_MODERATOR, hotelId, 'TEST Hotel Mod');
}

export async function login(
  t: TestApp,
  email: string,
  password: string,
): Promise<Actor> {
  const agent = request.agent(t.server);
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  const id = String(res.body?.user?.id ?? res.body?.id ?? '');
  const user = await t.model(User.name).findOne({ email }).lean<any>();
  return { agent, id: id || String(user._id), email, password };
}

async function insertAndLogin(
  t: TestApp,
  role: Role,
  providerId: Types.ObjectId | string | null,
  name: string,
): Promise<Actor> {
  const email = testEmail(role);
  await t.model(User.name).create({
    name,
    email,
    passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
    role,
    status: AccountStatus.ACTIVE,
    assignedProviderId: providerId
      ? new Types.ObjectId(String(providerId))
      : null,
    acceptedTermsAt: new Date(),
    emailVerified: true,
    mustChangePassword: false,
  });
  return login(t, email, TEST_PASSWORD);
}
