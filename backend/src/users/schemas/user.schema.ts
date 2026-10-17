import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
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

  @Prop({ type: String, default: 'USD' })
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

  // ACC-06: used for the 30-minute idle expiry.
  @Prop({ type: Date, default: null })
  lastActivityAt: Date | null;

  @Prop({ type: Number, default: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockUntil: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);