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

// Port 25 is commonly blocked by ISPs and cloud providers.
// These errors mean we couldn't complete SMTP handshake — not that the email is invalid.
const SMTP_BLOCKED_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'Connection timeout',
  'Connection closed prematurely',
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

/**
 * Free fallback using eva.pingutil.com — no API key required.
 * Used when port 25 SMTP is blocked/unreachable to get a real deliverable verdict.
 *
 * Response shape: { status: 'success', data: { deliverable, catch_all, disposable, gibberish, spam, ... } }
 */
async function checkEvaFreeApiFallback(email: string): Promise<SmtpVerifyResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.eva.pingutil.com/email?email=${encodeURIComponent(email)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (email-validator)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const json = (await res.json()) as {
      status?: string;
      data?: {
        deliverable?: boolean;
        catch_all?: boolean;
        disposable?: boolean;
        gibberish?: boolean;
        spam?: boolean;
        valid_syntax?: boolean;
      };
    };

    if (json.status !== 'success' || !json.data) return null;

    const { deliverable, catch_all, disposable, gibberish, spam } = json.data;

    if (disposable || gibberish || spam) {
      return { status: 'invalid', reasons: [`Eva API: Email flagged as ${disposable ? 'disposable' : gibberish ? 'gibberish' : 'spam'}`] };
    }
    if (deliverable === true) {
      // catch_all servers accept all mail — real but unconfirmable, mark as risky
      if (catch_all) {
        return { status: 'risky', reasons: ['Eva API: Domain uses catch-all — email format valid but mailbox unconfirmable'] };
      }
      return { status: 'valid', reasons: ['Eva API: Email is deliverable'] };
    }
    if (deliverable === false) {
      return { status: 'invalid', reasons: ['Eva API: Email is not deliverable'] };
    }
  } catch {
    // Eva API failed or timed out — proceed to final fallback
  }
  return null;
}

function checkSmtpMailbox(
  host: string,
  email: string,
  timeoutMs = 6000
): Promise<{ success: boolean; code: number; response: string; error?: string; blocked?: boolean }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let hasResolved = false;
    let stage = 0;
    let buffer = '';

    const resolveWith = (result: { success: boolean; code: number; response: string; error?: string; blocked?: boolean }) => {
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
      // Detect if port 25 is simply blocked (ECONNREFUSED, ETIMEDOUT etc.)
      const isBlocked = SMTP_BLOCKED_ERRORS.has(err.message) ||
        (err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
        (err as NodeJS.ErrnoException).code === 'ETIMEDOUT' ||
        (err as NodeJS.ErrnoException).code === 'EHOSTUNREACH';

      resolveWith({
        success: false,
        code: 0,
        response: '',
        error: err.message,
        blocked: isBlocked,
      });
    });

    socket.on('timeout', () => {
      resolveWith({
        success: false,
        code: 0,
        response: '',
        error: 'Connection timeout',
        blocked: true, // Timeout on port 25 = blocked, not invalid email
      });
    });

    socket.on('close', () => {
      if (!hasResolved) {
        resolveWith({
          success: false,
          code: 0,
          response: '',
          error: 'Connection closed prematurely',
          blocked: true,
        });
      }
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
  // ─────────────────────────────────────────────────────────────────────────────
  // IMPORTANT: Port 25 is blocked by most cloud providers and ISPs.
  // A connection error (timeout, ECONNREFUSED, etc.) does NOT mean the email is invalid.
  // It means we couldn't verify it — return 'risky' (has MX, but SMTP unreachable).
  // Only a definitive SMTP 550/551/554 rejection means the mailbox does NOT exist.
  // ─────────────────────────────────────────────────────────────────────────────
  const primaryServer = mxServers[0];
  const smtpCheck = await checkSmtpMailbox(primaryServer, email);

  if (smtpCheck.success) {
    reasons.push(`SMTP handshake succeeded: recipient mailbox confirmed (${smtpCheck.code})`);
    return { status: 'valid', reasons };
  }

  // Definitive rejection codes: mailbox does not exist
  if (smtpCheck.code === 550 || smtpCheck.code === 551 || smtpCheck.code === 553 || smtpCheck.code === 554) {
    reasons.push(`Mailbox rejected by server ${primaryServer}: ${smtpCheck.response}`);
    return { status: 'invalid', reasons };
  }

  // Port blocked / connection failed / timeout → SMTP unreachable.
  if (smtpCheck.blocked || smtpCheck.error) {
    reasons.push(`SMTP port 25 blocked/unreachable for ${primaryServer} — trying provider & API fallback`);

    const TRUSTED_DOMAINS = new Set([
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
      'yahoo.com', 'icloud.com', 'me.com', 'live.com', 'msn.com',
      'protonmail.com', 'proton.me', 'aol.com',
    ]);

    if (TRUSTED_DOMAINS.has(domain)) {
      return {
        status: 'valid',
        reasons: [...reasons, `Trusted provider domain (${domain}) with verified MX records`],
      };
    }

    const evaResult = await checkEvaFreeApiFallback(email);
    if (evaResult) {
      return { ...evaResult, reasons: [...reasons, ...evaResult.reasons] };
    }

    return {
      status: 'risky',
      reasons: [...reasons, `Could not reach SMTP server or free API — domain MX exists but mailbox unconfirmed`],
    };
  }

  // Any other non-success response (e.g. 421 temporary failure, 452 quota)
  // → try Eva API first, fall through to risky
  const evaFallback = await checkEvaFreeApiFallback(email);
  if (evaFallback) {
    return { ...evaFallback, reasons: [...reasons, ...evaFallback.reasons] };
  }

  reasons.push(`SMTP responded with code ${smtpCheck.code}: ${smtpCheck.response}`);
  return { status: 'risky', reasons };
}
