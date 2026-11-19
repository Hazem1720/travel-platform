import { SetMetadata } from '@nestjs/common';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';
export const EMAIL_NOT_VERIFIED =
  'Verify your email address before booking: open the link we emailed you';

// ACC-02 (bonus): routes that create or pay for a booking. JwtAuthGuard
// answers 403 while the account's email is not verified.
export const RequireVerifiedEmail = () =>
  SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);
