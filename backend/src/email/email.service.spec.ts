import { Types } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { EmailService } from './email.service';

// GEN-01-B: notifications (and moderator invitations) by email through SMTP.
describe('EmailService (GEN-01-B)', () => {
  const USER = new Types.ObjectId();
  const SMTP = {
    SMTP_HOST: 'localhost',
    SMTP_PORT: '2525',
    SMTP_FROM: 'Travel Platform <no-reply@example.test>',
  };
  let sendMail: jest.Mock;
  let createTransport: jest.SpyInstance;

  beforeEach(() => {
    sendMail = jest.fn(async () => ({ messageId: 'm1' }));
    createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as any);
  });
  afterEach(() => createTransport.mockRestore());

  function setup(
    env: Record<string, string> = SMTP,
    user: unknown = {
      email: 'sara@example.test',
      name: 'Sara',
      status: AccountStatus.ACTIVE,
    },
  ) {
    const users = { findById: jest.fn(() => ({ lean: async () => user })) };
    const service = new EmailService(
      { get: (k: string) => env[k] } as any,
      users as any,
    );
    return { service, users };
  }

  it('sends a notification to the user with a subject for its type', async () => {
    const { service } = setup();
    await expect(
      service.sendNotification(
        USER,
        NotificationType.BOOKING_CONFIRMED,
        'Your hotel reservation HT-ABCD1234 is confirmed',
      ),
    ).resolves.toEqual({
      to: 'sara@example.test',
      subject: 'Your booking is confirmed',
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 2525 }),
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Travel Platform <no-reply@example.test>',
      to: 'sara@example.test',
      subject: 'Your booking is confirmed',
      text: expect.stringContaining(
        'Your hotel reservation HT-ABCD1234 is confirmed',
      ),
    });
  });

  it('is off without SMTP_HOST: nothing is sent', async () => {
    const { service, users } = setup({});
    await expect(
      service.sendNotification(USER, NotificationType.REFUND_ISSUED, 'x'),
    ).resolves.toBeNull();
    expect(users.findById).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends nothing to a deactivated or unknown account', async () => {
    for (const user of [
      { email: 'x@example.test', name: 'X', status: AccountStatus.DEACTIVATED },
      null,
    ]) {
      await expect(
        setup(SMTP, user).service.sendNotification(
          USER,
          NotificationType.REFUND_ISSUED,
          'x',
        ),
      ).resolves.toBeNull();
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('never throws when the mail server is down', async () => {
    sendMail.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(
      setup().service.sendNotification(
        USER,
        NotificationType.REFUND_ISSUED,
        'x',
      ),
    ).resolves.toBeNull();
  });

  it('invites a new moderator without putting the password in the email', async () => {
    const { service } = setup();
    await expect(
      service.sendModeratorInvitation({
        email: 'mod@example.test',
        name: 'Omar',
        role: Role.HOTEL_MODERATOR,
      }),
    ).resolves.toEqual({
      to: 'mod@example.test',
      subject: 'You are invited to manage a hotel on Travel Platform',
    });
    const text: string = sendMail.mock.calls[0][0].text;
    expect(text).toContain('temporary password your administrator gives you');
    expect(text).not.toMatch(/password:\s*\S/i);
  });

  it('with SMTP down, the in-app notification is still created (NotificationsService)', async () => {
    sendMail.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const { service: email } = setup();
    const send = jest.spyOn(email, 'sendNotification');
    const model = {
      create: jest.fn(async (doc: any) => ({ toObject: () => doc })),
    };
    const notifications = new NotificationsService(model as any, email);
    await expect(
      notifications.create(USER, NotificationType.BOOKING_CONFIRMED, 'hi'),
    ).resolves.toMatchObject({ message: 'hi' });
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      USER,
      NotificationType.BOOKING_CONFIRMED,
      'hi',
    );
    await new Promise((r) => setImmediate(r));
  });

  it('NotificationsService works as before without an EmailService', async () => {
    const model = {
      create: jest.fn(async (doc: any) => ({ toObject: () => doc })),
    };
    await expect(
      new NotificationsService(model as any).create(
        USER,
        NotificationType.BOOKING_CONFIRMED,
        'hi',
      ),
    ).resolves.toMatchObject({ message: 'hi' });
  });
});
