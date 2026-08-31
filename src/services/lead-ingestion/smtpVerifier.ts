import dns from 'node:dns';
import net from 'node:net';
import validator from 'validator';

export interface SmtpVerifyResult {
  status: 'valid' | 'invalid' | 'risky' | 'unknown';
  reasons: string[];
}

const DNS_UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEOUT',
  'ESERVFAIL',
  'EREFUSED',
  'ECANCELLED',
]);

const publicDnsResolver = new dns.Resolver();
publicDnsResolver.setServers(['8.8.8.8', '1.1.1.1']);

function resolveMxWithTimeout(
  resolveFn: typeof dns.resolveMx,
  domain: string,
  timeoutMs = 4000
): Promise<Array<{ exchange: string; priority: number }>> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('DNS resolution timeout'), { code: 'ETIMEOUT' }));
    }, timeoutMs);
    resolveFn(domain, (err, addresses) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolvePromise(addresses);
    });
  });
}

async function getMxServers(domain: string): Promise<string[]> {
  try {
    const records = await resolveMxWithTimeout(dns.resolveMx, domain);
    if (records.length === 0) return [];
    return records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code && DNS_UNAVAILABLE_ERROR_CODES.has(code)) {
      try {
        const backupFn = publicDnsResolver.resolveMx.bind(publicDnsResolver);
        const records = await resolveMxWithTimeout(backupFn, domain);
        return records
          .sort((a, b) => a.priority - b.priority)
          .map((r) => r.exchange);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

// SMTP Handshake helper
function checkSmtpMailbox(
  host: string,
  email: string,
  timeoutMs = 6000
): Promise<{ success: boolean; code: number; response: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let hasResolved = false;
    let stage = 0; // 0: Connect, 1: HELO, 2: MAIL FROM, 3: RCPT TO, 4: QUIT
    let buffer = '';

    const resolveWith = (result: { success: boolean; code: number; response: string; error?: string }) => {
      if (hasResolved) return;
      hasResolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.connect(25, host, () => {
      // Socket connected, wait for welcome banner
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      if (!buffer.endsWith('\n')) return;

      const lines = buffer.trim().split('\r\n');
      const lastLine = lines[lines.length - 1] || '';
      buffer = ''; // reset buffer for next command

      const code = parseInt(lastLine.substring(0, 3), 10);

      try {
        if (stage === 0) {
          // Welcome banner received
          if (code !== 220) {
            return resolveWith({ success: false, code, response: lastLine, error: 'Invalid welcome code' });
          }
          socket.write('HELO leads-engine.com\r\n');
          stage = 1;
        } else if (stage === 1) {
          // HELO response
          if (code !== 250) {
            return resolveWith({ success: false, code, response: lastLine, error: 'HELO rejected' });
          }
          socket.write('MAIL FROM:<verify@leads-engine.com>\r\n');
          stage = 2;
        } else if (stage === 2) {
          // MAIL FROM response
          if (code !== 250) {
            return resolveWith({ success: false, code, response: lastLine, error: 'Sender rejected' });
          }
          socket.write(`RCPT TO:<${email}>\r\n`);
          stage = 3;
        } else if (stage === 3) {
          // RCPT TO response (This is our main check!)
          socket.write('QUIT\r\n');
          stage = 4;

          if (code === 250 || code === 251) {
            resolveWith({ success: true, code, response: lastLine });
          } else {
            resolveWith({ success: false, code, response: lastLine });
          }
        }
      } catch (err) {
        resolveWith({
          success: false,
          code: 0,
          response: '',
          error: err instanceof Error ? err.message : 'Write error',
        });
      }
    });

    socket.on('error', (err) => {
      resolveWith({
        success: false,
        code: 0,
        response: '',
        error: err.message,
      });
    });

    socket.on('timeout', () => {
      resolveWith({
        success: false,
        code: 0,
        response: '',
        error: 'Connection timeout',
      });
    });

    socket.on('close', () => {
      resolveWith({
        success: false,
        code: 0,
        response: '',
        error: 'Connection closed prematurely',
      });
    });
  });
}

export async function verifyEmailSmtp(email: string): Promise<SmtpVerifyResult> {
  const reasons: string[] = [];

  // 1. Syntax Check
  if (!email || !validator.isEmail(email)) {
    return {
      status: 'invalid',
      reasons: ['Email address does not match a valid format'],
    };
  }
  reasons.push('Syntax check passed');

  const [, domain] = email.split('@');

  // 2. DNS MX Records Check
  let mxServers: string[] = [];
  try {
    mxServers = await getMxServers(domain);
    if (mxServers.length === 0) {
      return {
        status: 'invalid',
        reasons: [`No mail exchange (MX) servers found for domain ${domain}`],
      };
    }
    reasons.push(`Resolved ${mxServers.length} MX record(s)`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return {
      status: 'unknown',
      reasons: [`DNS lookup for domain ${domain} failed: ${err.message || 'unknown error'}`],
    };
  }

  // 3. SMTP Handshake Check
  // Try connecting to the primary MX server
  const primaryServer = mxServers[0];
  const smtpCheck = await checkSmtpMailbox(primaryServer, email);

  if (smtpCheck.success) {
    reasons.push(`SMTP handshake succeeded: recipient mailbox exists (${smtpCheck.code})`);
    return {
      status: 'valid',
      reasons,
    };
  }

  // Interpret SMTP handshake failure
  if (smtpCheck.error) {
    const isNetworkBlock =
      smtpCheck.error.includes('timeout') ||
      smtpCheck.error.includes('REFUSED') ||
      smtpCheck.error.includes('access') ||
      smtpCheck.error.includes('closed');

    if (isNetworkBlock) {
      reasons.push(`SMTP check timed out or was blocked by network/ISP on port 25 (${smtpCheck.error})`);
      return {
        // Safe fallback - network blocked port 25
        status: 'risky',
        reasons,
      };
    }

    reasons.push(`SMTP handshake error on ${primaryServer}: ${smtpCheck.error}`);
    return {
      status: 'unknown',
      reasons,
    };
  }

  // If smtpCheck was unsuccessful but did not throw connection errors (e.g. got a 550)
  reasons.push(`Mailbox check failed on server ${primaryServer}: ${smtpCheck.response}`);
  if (smtpCheck.code === 550 || smtpCheck.code === 551 || smtpCheck.code === 554) {
    return {
      status: 'invalid',
      reasons,
    };
  }

  // Other codes (e.g. 450, 421) mean temporary greylisting or server congestion
  return {
    status: 'risky',
    reasons,
  };
}
