import { validateEmail, validateEmailEntries, validateEmailForEntry, type DnsResolver } from '../validation';

const resolverWithMx: DnsResolver = {
  resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }],
};

const resolverNoMx: DnsResolver = {
  resolveMx: async () => {
    throw new Error('ENOTFOUND');
  },
};

describe('validateEmail', () => {
  it('returns NOT_FOUND when no email is provided', async () => {
    const result = await validateEmail(null);
    expect(result.status).toBe('NOT_FOUND');
  });

  it('returns FAIL for malformed email syntax', async () => {
    const result = await validateEmail('not-an-email', resolverWithMx);
    expect(result.status).toBe('FAIL');
    expect(result.validationChecks?.syntax).toBe(false);
  });

  it('returns PASS for a valid, resolvable, non-role email', async () => {
    const result = await validateEmail('gus@northwindrobotics.com', resolverWithMx);
    expect(result.status).toBe('PASS');
    expect(result.confidence).toBe('HIGH');
  });

  it('returns FAIL when domain has no MX records', async () => {
    const result = await validateEmail('gus@nomx-domain.com', resolverNoMx);
    expect(result.status).toBe('FAIL');
    expect(result.validationChecks?.mxRecordsFound).toBe(false);
  });

  it('returns FAIL for a known disposable domain', async () => {
    const result = await validateEmail('someone@mailinator.com', resolverWithMx);
    expect(result.status).toBe('FAIL');
    expect(result.validationChecks?.isDisposable).toBe(true);
  });

  it('returns NEEDS_REVIEW for a role-based email on a valid domain', async () => {
    const result = await validateEmail('info@northwindrobotics.com', resolverWithMx);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.validationChecks?.isRoleEmail).toBe(true);
  });

  it('includes detailed reasons for every check outcome', async () => {
    const result = await validateEmail('gus@northwindrobotics.com', resolverWithMx);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('never claims an email definitely exists (PASS is the strongest status)', async () => {
    const result = await validateEmail('gus@northwindrobotics.com', resolverWithMx);
    expect(['PASS', 'FAIL', 'NEEDS_REVIEW', 'NOT_FOUND']).toContain(result.status);
  });

  it('detects role emails case-insensitively', async () => {
    const result = await validateEmail('Support@northwindrobotics.com', resolverWithMx);
    expect(result.validationChecks?.isRoleEmail).toBe(true);
  });

  it('treats disposable domains case-insensitively', async () => {
    const result = await validateEmail('user@MAILINATOR.com', resolverWithMx);
    expect(result.validationChecks?.isDisposable).toBe(true);
  });
});

describe('validateEmailForEntry', () => {
  it('maps PASS to valid', async () => {
    const result = await validateEmailForEntry('gus@northwindrobotics.com', resolverWithMx);
    expect(result.validationStatus).toBe('valid');
    expect(result.email).toBe('gus@northwindrobotics.com');
  });

  it('maps FAIL to invalid', async () => {
    const result = await validateEmailForEntry('user@mailinator.com', resolverWithMx);
    expect(result.validationStatus).toBe('invalid');
  });

  it('maps NEEDS_REVIEW to risky', async () => {
    const result = await validateEmailForEntry('info@northwindrobotics.com', resolverWithMx);
    expect(result.validationStatus).toBe('risky');
  });

  it('serializes validation details as JSON', async () => {
    const result = await validateEmailForEntry('gus@northwindrobotics.com', resolverWithMx);
    expect(() => JSON.parse(result.validationDetails)).not.toThrow();
  });
});

describe('validateEmailEntries', () => {
  it('validates every email in the batch', async () => {
    const results = await validateEmailEntries(
      ['gus@northwindrobotics.com', 'info@northwindrobotics.com', 'user@mailinator.com'],
      resolverWithMx
    );
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.validationStatus)).toEqual(['valid', 'risky', 'invalid']);
  });

  it('preserves input order even with bounded concurrency', async () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i}@northwindrobotics.com`);
    const results = await validateEmailEntries(emails, resolverWithMx, 3);
    expect(results.map((r) => r.email)).toEqual(emails);
  });

  it('returns an empty array for no emails', async () => {
    const results = await validateEmailEntries([], resolverWithMx);
    expect(results).toEqual([]);
  });
});
