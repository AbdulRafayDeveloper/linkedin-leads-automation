import { classifyEmailType, dedupeEmails, normalizeEmail } from '../emailUtils';

describe('normalizeEmail', () => {
  it('lowercases and trims the address', () => {
    expect(normalizeEmail('  John@Example.COM ')).toBe('john@example.com');
  });
});

describe('classifyEmailType', () => {
  it('classifies sales-shaped local parts', () => {
    expect(classifyEmailType('sales@acme.com')).toBe('SALES');
    expect(classifyEmailType('partnerships@acme.com')).toBe('SALES');
  });

  it('classifies support-shaped local parts', () => {
    expect(classifyEmailType('support@acme.com')).toBe('SUPPORT');
  });

  it('classifies HR/careers-shaped local parts', () => {
    expect(classifyEmailType('careers@acme.com')).toBe('HR');
  });

  it('classifies press/media-shaped local parts', () => {
    expect(classifyEmailType('press@acme.com')).toBe('PRESS');
  });

  it('classifies legal-shaped local parts', () => {
    expect(classifyEmailType('legal@acme.com')).toBe('LEGAL');
  });

  it('classifies general/info-shaped local parts', () => {
    expect(classifyEmailType('info@acme.com')).toBe('GENERAL');
    expect(classifyEmailType('hello@acme.com')).toBe('GENERAL');
  });

  it('falls back to UNKNOWN for a personal-looking local part', () => {
    expect(classifyEmailType('gus.gollings@acme.com')).toBe('UNKNOWN');
  });
});

describe('dedupeEmails', () => {
  it('treats emails as duplicates case-insensitively', () => {
    const result = dedupeEmails([
      { email: 'John@Example.com' },
      { email: 'john@example.com' },
      { email: 'JOHN@EXAMPLE.COM' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('John@Example.com');
  });

  it('keeps the first occurrence and preserves order for unique emails', () => {
    const result = dedupeEmails([{ email: 'a@x.com' }, { email: 'b@x.com' }]);
    expect(result.map((e) => e.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns an empty array for empty input', () => {
    expect(dedupeEmails([])).toEqual([]);
  });
});
