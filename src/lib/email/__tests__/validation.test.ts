import { validateEmail, type DnsResolver } from '../validation';

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
