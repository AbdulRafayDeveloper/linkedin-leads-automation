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

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'guerrillamail.com', '10minutemail.com',
  'trashmail.com', 'yopmail.com', 'throwawaymail.com', 'sharklasers.com',
  'dispostable.com', 'getairmail.com', 'maildrop.cc', 'temp-mail.org',
  'fakemailgenerator.com', 'byom.de', 'crazymailing.com', 'dayrep.com',
  'einrot.com', 'teleworm.us', 'armyspy.com', 'cuvox.de', 'rhyta.com',
  'nada.ltd', 'getnada.com', 'mohmal.com', 'burnermail.io',
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

async function checkFreeDisposableApi(email: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://disposable.debounce.io/?email=${encodeURIComponent(email)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const json = (await res.json()) as { disposable?: string | boolean };
    return json.disposable === 'true' || json.disposable === true;
  } catch {
    return false;
  }
}

async function checkAbstractApiFallback(email: string, apiKey: string): Promise<SmtpVerifyResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(`https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { deliverability?: string; is_valid_format?: { value: boolean }; is_disposable_email?: { value: boolean } };

    if (data.is_disposable_email?.value) {
      return { status: 'invalid', reasons: ['Abstract API: Disposable email address'] };
    }
    if (data.deliverability === 'DELIVERABLE') {
      return { status: 'valid', reasons: ['Abstract API: Email is deliverable'] };
    }
    if (data.deliverability === 'UNDELIVERABLE') {
      return { status: 'invalid', reasons: ['Abstract API: Email is undeliverable'] };
    }
    if (data.deliverability === 'RISKY') {
      return { status: 'risky', reasons: ['Abstract API: Low deliverability score (risky)'] };
    }
  } catch {
    // API fallback failed, proceed with built-in logic
  }
  return null;
}

function checkSmtpMailbox(
  host: string,
  email: string,
  timeoutMs = 4000
): Promise<{ success: boolean; code: number; response: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let hasResolved = false;
    let stage = 0;
    let buffer = '';

    const resolveWith = (result: { success: boolean; code: number; response: string; error?: string }) => {
      if (hasResolved) return;
      hasResolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.connect(25, host, () => {
      // socket connected
    });

    socket.on('data', (data) => {
      buffer += data.toString();
      if (!buffer.endsWith('\n')) return;

      const lines = buffer.trim().split('\r\n');
      const lastLine = lines[lines.length - 1] || '';
      buffer = '';

      const code = parseInt(lastLine.substring(0, 3), 10);

      try {
        if (stage === 0) {
          if (code !== 220) {
            return resolveWith({ success: false, code, response: lastLine, error: 'Invalid welcome code' });
          }
          socket.write('HELO leads-engine.com\r\n');
          stage = 1;
        } else if (stage === 1) {
          if (code !== 250) {
            return resolveWith({ success: false, code, response: lastLine, error: 'HELO rejected' });
          }
          socket.write('MAIL FROM:<verify@leads-engine.com>\r\n');
          stage = 2;
        } else if (stage === 2) {
          if (code !== 250) {
            return resolveWith({ success: false, code, response: lastLine, error: 'Sender rejected' });
          }
          socket.write(`RCPT TO:<${email}>\r\n`);
          stage = 3;
        } else if (stage === 3) {
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

  const domain = (email.split('@')[1] || '').toLowerCase().trim();

  // 2. Local & Open API Disposable Burner Check
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      status: 'invalid',
      reasons: [`Disposable / temporary burner email domain detected (${domain})`],
    };
  }

  const isDisposableApi = await checkFreeDisposableApi(email);
  if (isDisposableApi) {
    return {
      status: 'invalid',
      reasons: [`Open API flagged domain as temporary disposable email (${domain})`],
    };
  }

  // 3. Third-Party API Key Fallback (if ABSTRACT_EMAIL_API_KEY is set in process.env)
  if (process.env.ABSTRACT_EMAIL_API_KEY) {
    const abstractResult = await checkAbstractApiFallback(email, process.env.ABSTRACT_EMAIL_API_KEY);
    if (abstractResult) return abstractResult;
  }

  // 4. DNS MX Records Check
  let mxServers: string[] = [];
  try {
    mxServers = await getMxServers(domain);
    if (mxServers.length === 0) {
      return {
        status: 'invalid',
        reasons: [`No mail exchange (MX) servers found for domain ${domain}`],
      };
    }
    reasons.push(`Resolved ${mxServers.length} MX record(s): ${mxServers[0]}`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    return {
      status: 'unknown',
      reasons: [`DNS lookup for domain ${domain} failed: ${err.message || 'unknown error'}`],
    };
  }

  // 5. Direct SMTP Handshake Check
  const primaryServer = mxServers[0];
  const smtpCheck = await checkSmtpMailbox(primaryServer, email);

  if (smtpCheck.success) {
    reasons.push(`SMTP handshake succeeded: recipient mailbox exists (${smtpCheck.code})`);
    return {
      status: 'valid',
      reasons,
    };
  }

  if (smtpCheck.code === 550 || smtpCheck.code === 551 || smtpCheck.code === 554) {
    reasons.push(`Mailbox check failed on server ${primaryServer}: ${smtpCheck.response}`);
    return {
      status: 'invalid',
      reasons,
    };
  }

  if (smtpCheck.error) {
    reasons.push(`Verified MX server ${primaryServer} for domain ${domain}`);
    return {
      status: 'valid',
      reasons,
    };
  }

  return {
    status: 'valid',
    reasons,
  };
}
