import * as nodemailer from 'nodemailer';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { EmailService } from './email.service';

// ACC-02, ACC-07, ACC-13, GEN-01-B: the emails other than notifications, the
// SMTP settings, and the cases that must send nothing or never throw.
describe('EmailService links and SMTP settings (GEN-01-B)', () => {
  let sendMail: jest.Mock;
  let createTransport: jest.SpyInstance;

  beforeEach(() => {
    sendMail = jest.fn(async () => ({ messageId: 'm1' }));
    createTransport = jest
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as any);
  });
  afterEach(() => createTransport.mockRestore());

  const service = (env: Record<string, string | undefined>, user?: unknown) =>
    new EmailService(
      { get: (k: string) => env[k] } as any,
      {
        findById: jest.fn(() => ({ lean: async () => user ?? null })),
      } as any,
    );
  const ON = { SMTP_HOST: 'smtp.test' };

  it('sends the verification link once, with the link in the text', async () => {
    const r = await service(ON).sendEmailVerification(
      'sara@example.test',
      'Sara',
      'http://x/verify?token=abc',
    );
    expect(r).toEqual({
      to: 'sara@example.test',
      subject: 'Verify your email address for Travel Platform',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].text).toContain(
      'http://x/verify?token=abc',
    );
  });

  it('sends the reset link and says it expires in 30 minutes', async () => {
    await service(ON).sendPasswordReset('sara@example.test', 'Sara', 'L1');
    const mail = sendMail.mock.calls[0][0];
    expect(mail.subject).toBe('Reset your Travel Platform password');
    expect(mail.text).toContain('L1');
    expect(mail.text).toContain('30 minutes');
  });

  it.each([
    [
      'verification',
      (s: EmailService) => s.sendEmailVerification('a@b.c', 'A', 'L'),
    ],
    ['reset', (s: EmailService) => s.sendPasswordReset('a@b.c', 'A', 'L')],
    [
      'invitation',
      (s: EmailService) =>
        s.sendModeratorInvitation({
          email: 'a@b.c',
          name: 'A',
          role: Role.HOTEL_MODERATOR,
        }),
    ],
  ])('sends no %s email when SMTP is off', async (_name, send) => {
    await expect(send(service({}))).resolves.toBeNull();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it.each([
    [
      'verification',
      (s: EmailService) => s.sendEmailVerification('a@b.c', 'A', 'L'),
    ],
    ['reset', (s: EmailService) => s.sendPasswordReset('a@b.c', 'A', 'L')],
  ])('a failing mail server never breaks the %s request', async (_n, send) => {
    sendMail.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(send(service(ON))).resolves.toBeNull();
  });

  it('names an airline in an airline moderator invitation', async () => {
    await service(ON).sendModeratorInvitation({
      email: 'm@b.c',
      name: 'M',
      role: Role.AIRLINE_MODERATOR,
    });
    expect(sendMail.mock.calls[0][0].subject).toBe(
      'You are invited to manage an airline on Travel Platform',
    );
  });

  it('uses port 587 without TLS and no login by default', async () => {
    await service(ON).sendPasswordReset('a@b.c', 'A', 'L');
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.test',
        port: 587,
        secure: false,
        auth: undefined,
      }),
    );
    expect(sendMail.mock.calls[0][0].from).toBe(
      'Travel Platform <no-reply@example.test>',
    );
  });

  it('uses TLS on port 465 and logs in when SMTP_USER is set (empty password allowed)', async () => {
    await service({
      ...ON,
      SMTP_PORT: '465',
      SMTP_USER: 'me@gmail.com',
      SMTP_FROM: 'Me <me@gmail.com>',
    }).sendPasswordReset('a@b.c', 'A', 'L');
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 465,
        secure: true,
        auth: { user: 'me@gmail.com', pass: '' },
      }),
    );
    expect(sendMail.mock.calls[0][0].from).toBe('Me <me@gmail.com>');
  });

  it('creates the SMTP connection once for many emails', async () => {
    const s = service(ON);
    await s.sendPasswordReset('a@b.c', 'A', 'L');
    await s.sendEmailVerification('a@b.c', 'A', 'L');
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for an invalid user id, without a query', async () => {
    const s = service(ON);
    await expect(
      s.sendNotification('not-an-id', NotificationType.BOOKING_CONFIRMED, 'x'),
    ).resolves.toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends nothing to an account without an email address', async () => {
    const s = service(ON, { name: 'No Mail', status: 'active' });
    await expect(
      s.sendNotification(
        new Types.ObjectId(),
        NotificationType.BOOKING_CONFIRMED,
        'x',
      ),
    ).resolves.toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('uses a generic subject for a type without its own', async () => {
    const s = service(ON, {
      email: 'a@b.c',
      name: 'A',
      status: 'active',
    });
    await s.sendNotification(
      new Types.ObjectId(),
      'SOMETHING_NEW' as NotificationType,
      'hello',
    );
    expect(sendMail.mock.calls[0][0].subject).toBe(
      'Travel Platform notification',
    );
  });
});
