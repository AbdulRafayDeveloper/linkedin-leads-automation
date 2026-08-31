import { verifyEmailSmtp } from '../smtpVerifier';
import dns from 'node:dns';
import net from 'node:net';

jest.mock('node:dns', () => {
  const original = jest.requireActual('node:dns');
  return {
    ...original,
    resolveMx: jest.fn(),
  };
});

jest.mock('node:net', () => {
  return {
    Socket: jest.fn().mockImplementation(() => {
      let onCallbacks: Record<string, Function> = {};
      const socket = {
        setTimeout: jest.fn(),
        connect: jest.fn().mockImplementation((port, host, cb) => {
          if (cb) setTimeout(cb, 10);
          // Trigger welcome banner
          setTimeout(() => {
            if (onCallbacks['data']) {
              onCallbacks['data']('220 welcome.mailserver.com\r\n');
            }
          }, 20);
        }),
        write: jest.fn().mockImplementation((command) => {
          setTimeout(() => {
            if (onCallbacks['data']) {
              if (command.startsWith('HELO')) {
                onCallbacks['data']('250 Hello\r\n');
              } else if (command.startsWith('MAIL FROM')) {
                onCallbacks['data']('250 Sender OK\r\n');
              } else if (command.startsWith('RCPT TO')) {
                if (command.includes('invalid')) {
                  onCallbacks['data']('550 User unknown\r\n');
                } else if (command.includes('risky')) {
                  onCallbacks['data']('450 Temporary failure\r\n');
                } else {
                  onCallbacks['data']('250 Recipient OK\r\n');
                }
              }
            }
          }, 10);
        }),
        on: jest.fn().mockImplementation((event, cb) => {
          onCallbacks[event] = cb;
          return socket;
        }),
        destroy: jest.fn(),
      };
      return socket;
    }),
  };
});

describe('smtpVerifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('identifies invalid email syntax before network calls', async () => {
    const result = await verifyEmailSmtp('not-an-email');
    expect(result.status).toBe('invalid');
    expect(result.reasons).toContain('Email address does not match a valid format');
    expect(dns.resolveMx).not.toHaveBeenCalled();
  });

  it('marks email as valid when recipient is accepted (250)', async () => {
    (dns.resolveMx as unknown as jest.Mock).mockImplementation((domain, cb) => {
      cb(null, [{ exchange: 'mx.test.com', priority: 10 }]);
    });

    const result = await verifyEmailSmtp('test@test.com');
    expect(result.status).toBe('valid');
    expect(result.reasons.some((r) => r.includes('SMTP handshake succeeded'))).toBe(true);
  });

  it('marks email as invalid when recipient is rejected (550)', async () => {
    (dns.resolveMx as unknown as jest.Mock).mockImplementation((domain, cb) => {
      cb(null, [{ exchange: 'mx.test.com', priority: 10 }]);
    });

    const result = await verifyEmailSmtp('invalid@test.com');
    expect(result.status).toBe('invalid');
    expect(result.reasons.some((r) => r.includes('User unknown'))).toBe(true);
  });

  it('marks email as risky on temporary server failure (450)', async () => {
    (dns.resolveMx as unknown as jest.Mock).mockImplementation((domain, cb) => {
      cb(null, [{ exchange: 'mx.test.com', priority: 10 }]);
    });

    const result = await verifyEmailSmtp('risky@test.com');
    expect(result.status).toBe('risky');
  });
});
