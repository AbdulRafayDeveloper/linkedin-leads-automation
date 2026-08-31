import { sendOutboundEmail } from '../mailer';
import nodemailer from 'nodemailer';

const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockImplementation(() => ({
    sendMail: mockSendMail,
  })),
}));

describe('mailer service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      SMTP_USER: 'test@gmail.com',
      SMTP_PASS: 'password',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails to send when credentials are not configured', async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const result = await sendOutboundEmail({
      to: 'to@test.com',
      subject: 'Hi',
      htmlBody: 'body',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('SMTP credentials');
  });

  it('sends email successfully when transporter functions correctly', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-123' });

    const result = await sendOutboundEmail({
      to: 'to@test.com',
      subject: 'Hi',
      htmlBody: 'body',
    });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-123');
  });

  it('handles transmission errors gracefully', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Connection failed'));

    const result = await sendOutboundEmail({
      to: 'to@test.com',
      subject: 'Hi',
      htmlBody: 'body',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection failed');
  });
});
