// TEMPORARY diagnostic: why does the public-route session check not attach the user?
import { createTestApp, TestApp } from './e2e/app';
import { traveler } from './e2e/actors';
import { seedReference } from './e2e/fixtures';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('debug', () => {
  let t: TestApp;
  beforeAll(async () => { t = await createTestApp('dbg'); await seedReference(t); }, 60_000);
  afterAll(async () => t?.close());
  it('attachIfLoggedIn', async () => {
    const A = await traveler(t, 'TEST A');
    const res = await A.agent.get('/api/auth/me');
    const jar = (A.agent as any).jar;
    const cookies = jar.getCookies({ domain: '127.0.0.1', path: '/api/posts/x', secure: false, script: false });
    console.log('DEBUG me', res.status, 'cookies for /api/posts:', cookies.map((c: any) => `${c.name} path=${c.path} secure=${c.secure}`).join(' | '));
    const all = jar.getCookies({ domain: '127.0.0.1', path: '/', secure: true, script: false });
    console.log('DEBUG all cookies:', all.map((c: any) => `${c.name} path=${c.path} domain=${c.domain} secure=${c.secure}`).join(' | '));
    const guard = t.app.get(JwtAuthGuard) as any;
    const access = all.find((c: any) => c.name === 'access_token');
    const req: any = { cookies: { access_token: access?.value } };
    try { await guard.attachIfLoggedIn(req); console.log('DEBUG attach ok, user =', JSON.stringify(req.user)); }
    catch (e) { console.log('DEBUG attach threw:', (e as Error).message); }
    const post = await A.agent.post('/api/posts').send({ title: 'TEST d', body: 'x' });
    const r = await A.agent.get(`/api/posts/${post.body._id}`);
    console.log('DEBUG own draft via HTTP', r.status, 'request cookie header sent:', (r as any).req?.getHeader?.('cookie'));
  });
});
