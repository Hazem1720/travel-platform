// Jest setupFiles for npm run test:e2e.
// The database flow runs only against E2E_MONGODB_URI, a throwaway database
// you set on purpose. It never falls back to MONGODB_URI, so the shared
// team database is never written to by tests.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI =
  process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/e2e-never-connect';
process.env.JWT_SECRET = 'e2e-test-secret-e2e-test-secret-123456';
process.env.JWT_EXPIRES_IN = '15m';
process.env.FRONTEND_URL = 'http://localhost:3001';
// supertest talks plain http, where a client does not send Secure cookies back.
process.env.COOKIE_SECURE = 'false';
