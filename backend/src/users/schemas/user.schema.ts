import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';
import { AccountStatus, Role } from '../../common/enums/role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ type: String, enum: Object.values(Role), default: Role.USER })
  role: Role;

  @Prop({
    type: String,
    enum: Object.values(AccountStatus),
    default: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  // Set only for moderators: the one airline or hotel they manage.
  @Prop({ type: Types.ObjectId, default: null })
  assignedProviderId: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  phone: string;

  @Prop({ type: String, enum: SUPPORTED_CURRENCIES, default: 'USD' })
  preferredCurrency: string;

  // ACC-01: consent to the terms and privacy policy.
  @Prop({ type: Date, default: null })
  acceptedTermsAt: Date | null;

  // ACC-07a / ACC-13: true after an admin sets a temporary password.
  @Prop({ type: Boolean, default: false })
  mustChangePassword: boolean;

  // ACC-06: only the SHA-256 hash of the refresh token is stored.
  @Prop({ type: String, default: null, select: false })
  refreshTokenHash: string | null;

  // ACC-06: copied into every access token as "sv". Incrementing it revokes
  // all access tokens already issued (logout, password change, deactivation).
  @Prop({ type: Number, default: 0 })
  sessionVersion: number;

  // ACC-06: used for the 30-minute idle expiry.
  @Prop({ type: Date, default: null })
  lastActivityAt: Date | null;

  // ACC-02 (bonus): false from registration until the emailed link is
  // opened; bookings are refused meanwhile. Accounts from before ACC-02, and
  // admins and moderators, are verified. Only the SHA-256 hash of the link's
  // token is stored.
  @Prop({ type: Boolean, default: true })
  emailVerified: boolean;

  @Prop({ type: String, default: null, select: false })
  emailVerificationTokenHash: string | null;

  @Prop({ type: Date, default: null, select: false })
  emailVerificationExpiresAt: Date | null;

  // ACC-07 (bonus): the current password-reset link (hash only). A newer
  // request replaces it; using it clears it.
  @Prop({ type: String, default: null, select: false })
  passwordResetTokenHash: string | null;

  @Prop({ type: Date, default: null, select: false })
  passwordResetExpiresAt: Date | null;

  @Prop({ type: Number, default: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockUntil: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
