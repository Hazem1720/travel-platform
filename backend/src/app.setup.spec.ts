import { securityHeaders } from './app.setup';

describe('securityHeaders (OWASP A05)', () => {
  it('sets nosniff, frame, referrer and opener headers and continues', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) };
    const next = jest.fn();
    securityHeaders({} as any, res as any, next);
    expect(headers).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    expect(next).toHaveBeenCalled();
  });
});
