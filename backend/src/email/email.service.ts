import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as nodemailer from 'nodemailer';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

const SUBJECT: Record<NotificationType, string> = {
  [NotificationType.BOOKING_CONFIRMED]: 'Your booking is confirmed',
  [NotificationType.BOOKING_CANCELLED]: 'Your booking was cancelled',
  [NotificationType.REFUND_ISSUED]: 'About your refund',
  [NotificationType.FLIGHT_SCHEDULE_CHANGED]: 'Your flight schedule changed',
  [NotificationType.ACCOUNT_SUSPENDED]: 'Your account was suspended',
  [NotificationType.PROVIDER_SUSPENDED]: 'Your provider was suspended',
  [NotificationType.REVIEW_REPLIED]: 'The hotel replied to your review',
  [NotificationType.BOOKING_CHANGED]: 'Your flight booking was changed',
} as Record<NotificationType, string>;

const APP = 'Travel Platform';

export interface SentEmail {
  to: string;
  subject: string;
}

// GEN-01-B (Memo, bonus): the GEN-01 notifications, and moderator
// invitations, also go out by email through SMTP. In development the SMTP
// settings point at a test inbox (Mailtrap, Ethereal or a local catcher);
// they live only in backend/.env. Without SMTP_HOST, email is off and
// nothing else changes. Sending never throws: an SMTP failure is logged and
// the in-app notification stands.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transport: nodemailer.Transporter | null | undefined;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  get enabled(): boolean {
    return !!this.config.get<string>('SMTP_HOST');
  }

  // Called by NotificationsService.create() after the in-app notification is
  // saved, without waiting for it.
  async sendNotification(
    userId: Types.ObjectId | string,
    type: NotificationType,
    message: string,
  ): Promise<SentEmail | null> {
    if (!this.enabled || !isValidObjectId(userId)) return null;
    try {
      const user = await this.users
        .findById(userId, { email: 1, name: 1, status: 1 })
        .lean<{ email: string; name: string; status: AccountStatus }>();
      // Nobody reads a deactivated account's mail.
      if (!user?.email || user.status === AccountStatus.DEACTIVATED) {
        return null;
      }
      return await this.send(
        user.email,
        SUBJECT[type] ?? `${APP} notification`,
        `Hello ${user.name},\n\n${message}\n\nYou can also see this under ` +
          `Notifications in your ${APP} account.\n`,
      );
    } catch (err) {
      this.logger.error(
        `Email for a ${type} notification failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ACC-13: tells a new moderator their account exists. The temporary
  // password is NOT in the email: the admin gives it to them, and it must
  // be changed at the first sign-in (ACC-07a).
  async sendModeratorInvitation(moderator: {
    email: string;
    name: string;
    role: Role;
  }): Promise<SentEmail | null> {
    if (!this.enabled) return null;
    const what =
      moderator.role === Role.AIRLINE_MODERATOR ? 'an airline' : 'a hotel';
    try {
      return await this.send(
        moderator.email,
        `You are invited to manage ${what} on ${APP}`,
        `Hello ${moderator.name},\n\nAn administrator created a moderator ` +
          `account for you on ${APP}, to manage ${what}.\n\nSign in with ` +
          `this email address and the temporary password your administrator ` +
          `gives you. You will be asked to choose your own password at the ` +
          `first sign-in.\n`,
      );
    } catch (err) {
      this.logger.error(
        `Moderator invitation email failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ACC-02 (bonus): the verification link after registration.
  async sendEmailVerification(
    to: string,
    name: string,
    link: string,
  ): Promise<SentEmail | null> {
    if (!this.enabled) return null;
    try {
      return await this.send(
        to,
        `Verify your email address for ${APP}`,
        `Hello ${name},\n\nWelcome to ${APP}. Open this link to verify ` +
          `your email address; you can book once it is verified:\n\n${link}\n\n` +
          `The link works once and expires in 24 hours. If you did not ` +
          `register, ignore this email.\n`,
      );
    } catch (err) {
      this.logger.error(`Verification email failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ACC-07 (bonus): the password-reset link.
  async sendPasswordReset(
    to: string,
    name: string,
    link: string,
  ): Promise<SentEmail | null> {
    if (!this.enabled) return null;
    try {
      return await this.send(
        to,
        `Reset your ${APP} password`,
        `Hello ${name},\n\nSomeone asked to reset the password of your ` +
          `${APP} account. Open this link to choose a new one:\n\n${link}\n\n` +
          `The link works once and expires in 30 minutes; asking again ` +
          `replaces it. If it was not you, ignore this email: your password ` +
          `has not changed.\n`,
      );
    } catch (err) {
      this.logger.error(
        `Password reset email failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async send(
    to: string,
    subject: string,
    text: string,
  ): Promise<SentEmail> {
    await this.smtp().sendMail({
      from:
        this.config.get<string>('SMTP_FROM') ??
        `${APP} <no-reply@example.test>`,
      to,
      subject,
      text,
    });
    return { to, subject };
  }

  private smtp(): nodemailer.Transporter {
    if (!this.transport) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      const user = this.config.get<string>('SMTP_USER');
      this.transport = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port,
        secure: port === 465,
        auth: user
          ? { user, pass: this.config.get<string>('SMTP_PASS') ?? '' }
          : undefined,
        // Never hold a request for long if the mail server is down.
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
    }
    return this.transport;
  }
}
