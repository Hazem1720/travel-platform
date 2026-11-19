import * as nock from 'nock';

// Jest setupFilesAfterEnv for the e2e tests: no test may reach the internet.
// Only the local app (supertest) and the local MongoDB are allowed; outside
// services (FXRatesAPI, ...) are faked with nock in the test that needs them.
// nock 14 also intercepts Node's global fetch, which the FX client uses. The
// MongoDB driver uses raw sockets, which nock does not touch.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/;

nock.disableNetConnect();
nock.enableNetConnect((host) => LOCAL.test(host));

afterEach(() => {
  // A suite that set up a fake must not leak it into the next test.
  nock.cleanAll();
});
