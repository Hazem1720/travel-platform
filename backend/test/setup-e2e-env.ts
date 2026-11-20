// Jest setupFiles for the e2e tests: runs in every test worker before the
// test file (and so before AppModule) is loaded.
import { assertSafeTestUri, guardOptionsFromEnv } from './e2e/uri-guard';

// The database comes from global-setup.ts (an in-memory MongoDB) or from
// E2E_MONGODB_URI set on purpose. Never MONGODB_URI from backend/.env: the
// guard refuses it, so the shared team database is never written to.
assertSafeTestUri(process.env.E2E_MONGODB_URI, guardOptionsFromEnv());

process.env.NODE_ENV = 'test';
// Each test app connects to its own database (createTestApp); this value
// only satisfies env validation.
process.env.MONGODB_URI = process.env.E2E_MONGODB_URI;
process.env.JWT_SECRET = 'e2e-test-secret-e2e-test-secret-123456';
process.env.JWT_EXPIRES_IN = '15m';
process.env.FRONTEND_URL = 'http://localhost:3001';
// supertest talks plain http, where a client does not send Secure cookies back.
process.env.COOKIE_SECURE = 'false';
process.env.PLATFORM_CURRENCY = 'USD';
process.env.SEED_REFERENCE_ON_START = 'false';
// PAY-01: the gateway is replaced by FakeStripeGateway, so this key is never
// sent anywhere; the webhook secret is real and signs test events.
process.env.STRIPE_SECRET_KEY = 'sk_test_e2e_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_e2e_test_secret';
// Email is "on" so the emails are built; createTestApp replaces the SMTP
// transport with an in-memory outbox, so nothing is sent.
process.env.SMTP_HOST = 'smtp.e2e.invalid';
// FXRatesAPI is faked with nock; this key only lets the client run.
process.env.FXRATES_API_KEY = 'e2e-fx-key';
