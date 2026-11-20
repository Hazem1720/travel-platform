import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// GEN-13: every route requires a logged-in user by default (global JwtAuthGuard).
// Mark a route @Public() only when a guest must reach it, for example
// register, login, flight and hotel search, public posts and itineraries,
// or the Stripe webhook (which must verify the Stripe signature instead).
// Every public route must also be added to the allowlist in
// src/auth/route-guards.spec.ts, so each one is reviewed on purpose.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
