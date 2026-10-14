import {
  buildLeadBoxes,
  dedupeEmails,
  emailStatusMeta,
  formatLeadDate,
  isPlaceholderValue,
  looksUnreliableName,
  pickLinkedInUrl,
  realValue,
  resolveEmailStatus,
  buildVerificationMap,
  type LeadCardRecord,
} from '../cards';

function lead(overrides: Partial<LeadCardRecord> = {}): LeadCardRecord {
  return {
    _id: 'lead1',
    fullName: 'Jake Cook',
    companyName: null,
    jobTitle: null,
    email: null,
    ...overrides,
  };
}

describe('resolveEmailStatus', () => {
  const map = buildVerificationMap([{ email: 'Jake@Acme.com', status: 'valid' }]);

  it('matches the exact address, ignoring case', () => {
    expect(resolveEmailStatus('jake@acme.com', map)).toBe('valid');
    expect(resolveEmailStatus('JAKE@ACME.COM', map)).toBe('valid');
  });

  it('never borrows another address’s result', () => {
    expect(resolveEmailStatus('someone-else@acme.com', map)).toBe('unchecked');
  });

  it('uses the lead level status only for the lead’s own primary email', () => {
    expect(
      resolveEmailStatus('primary@acme.com', new Map(), {
        primaryEmail: 'primary@acme.com',
        primaryStatus: 'risky',
      })
    ).toBe('risky');
    expect(
      resolveEmailStatus('other@acme.com', new Map(), {
        primaryEmail: 'primary@acme.com',
        primaryStatus: 'risky',
      })
    ).toBe('unchecked');
  });
});

describe('dedupeEmails', () => {
  it('keeps the first spelling and drops duplicates and junk', () => {
    expect(dedupeEmails(['A@b.com', 'a@B.com', ' c@d.com ', '', null, 'not-an-email'])).toEqual([
      'A@b.com',
      'c@d.com',
    ]);
  });
});

describe('buildLeadBoxes', () => {
  it('builds a personal box and one box per real company', () => {
    const boxes = buildLeadBoxes(
      lead({
        email: 'jake@mail.com',
        emailValidationStatus: 'valid',
        currentCompanies: [
          {
            companyName: 'Acme',
            jobTitle: 'CTO',
            websiteUrl: null,
            companyEmails: ['hi@acme.com'],
            approved: true,
          },
        ],
      })
    );

    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ kind: 'personal', approved: false });
    expect(boxes[0].emails[0]).toMatchObject({ email: 'jake@mail.com', status: 'valid' });
    expect(boxes[1]).toMatchObject({ kind: 'company', title: 'Acme', approved: true });
  });

  it('invents no company when the lead has none', () => {
    const boxes = buildLeadBoxes(lead({ companyName: 'Leftover Corp', jobTitle: 'Professional' }));
    expect(boxes).toHaveLength(1);
    expect(boxes[0].kind).toBe('personal');
  });

  it('marks an address that appears in two boxes as shared', () => {
    const boxes = buildLeadBoxes(
      lead({
        email: 'jake@acme.com',
        currentCompanies: [
          {
            companyName: 'Acme',
            jobTitle: null,
            websiteUrl: null,
            companyEmails: ['JAKE@acme.com'],
            approved: false,
          },
        ],
      })
    );
    expect(boxes[0].emails[0].shared).toBe(true);
    expect(boxes[1].emails[0].shared).toBe(true);
  });

  it('does not mark a unique address as shared', () => {
    const boxes = buildLeadBoxes(lead({ email: 'jake@acme.com' }));
    expect(boxes[0].emails[0].shared).toBe(false);
  });

  it('gives an unverified company address its own status, not the first one’s', () => {
    const boxes = buildLeadBoxes(
      lead({
        verifiedEmails: [{ email: 'first@acme.com', status: 'valid' }],
        currentCompanies: [
          {
            companyName: 'Acme',
            jobTitle: null,
            websiteUrl: null,
            companyEmails: ['first@acme.com', 'second@acme.com'],
            approved: false,
          },
        ],
      })
    );
    expect(boxes[1].emails.map((row) => row.status)).toEqual(['valid', 'unchecked']);
  });

  it('drops a placeholder company name but keeps the box', () => {
    const boxes = buildLeadBoxes(
      lead({
        currentCompanies: [
          {
            companyName: 'Unspecified Company',
            jobTitle: 'Professional',
            websiteUrl: null,
            companyEmails: [],
            approved: false,
          },
        ],
      })
    );
    expect(boxes[1]).toMatchObject({ title: 'Company', subtitle: null, emails: [] });
  });
});

describe('placeholder and name checks', () => {
  it.each(['Unspecified Company', 'Unknown Company', 'Professional', '', '   ', null])(
    'treats %p as no value',
    (value) => {
      expect(isPlaceholderValue(value)).toBe(true);
      expect(realValue(value)).toBeNull();
    }
  );

  it('keeps a real value', () => {
    expect(realValue('  Acme  ')).toBe('Acme');
  });

  it.each(['0 notifications', 'https://example.com/x', 'a@b.com', '•••'])(
    'flags %p as an unreliable name',
    (value) => {
      expect(looksUnreliableName(value)).toBe(true);
    }
  );

  it.each(['Jake Cook', "Mary-Jane O'Neil", 'Yuriy Zaletskyy', 'José Álvarez'])(
    'accepts %p as a name',
    (value) => {
      expect(looksUnreliableName(value)).toBe(false);
    }
  );
});

describe('pickLinkedInUrl', () => {
  it('prefers the portfolio link', () => {
    expect(
      pickLinkedInUrl(lead({ portfolioUrl: 'https://www.linkedin.com/in/jake/' }))
    ).toBe('https://www.linkedin.com/in/jake/');
  });

  it('falls back to the extra URLs, then to the pasted text', () => {
    expect(pickLinkedInUrl(lead({ additionalUrls: ['https://acme.com', 'linkedin.com/in/kim'] }))).toBe(
      'https://linkedin.com/in/kim'
    );
    expect(pickLinkedInUrl(lead({ rawLinkedinUrl: 'https://linkedin.com/in/ana' }))).toBe(
      'https://linkedin.com/in/ana'
    );
  });

  it('strips punctuation the extractor swallowed', () => {
    expect(pickLinkedInUrl(lead({ rawLinkedinUrl: 'https://www.linkedin.com/in/jane-doe/,' }))).toBe(
      'https://www.linkedin.com/in/jane-doe/'
    );
    expect(pickLinkedInUrl(lead({ rawLinkedinUrl: 'https://www.linkedin.com/in/jane)' }))).toBe(
      'https://www.linkedin.com/in/jane'
    );
  });

  it('ignores links that are not LinkedIn, and broken ones', () => {
    expect(pickLinkedInUrl(lead({ portfolioUrl: 'https://acme.com' }))).toBeNull();
    expect(pickLinkedInUrl(lead({ rawLinkedinUrl: 'https://notlinkedin.com.evil.net/x' }))).toBeNull();
    expect(pickLinkedInUrl(lead())).toBeNull();
  });
});

describe('status meta and dates', () => {
  it('separates never checked from checked but unclear, and flags risky', () => {
    expect(emailStatusMeta('unchecked').label).toBe('Not checked');
    expect(emailStatusMeta('pending').label).toBe('Checking');
    expect(emailStatusMeta('unknown').label).toBe('Unknown');
    expect(emailStatusMeta('risky')).toMatchObject({ label: 'Risky', tone: 'warning' });
    expect(emailStatusMeta('valid')).toMatchObject({ label: 'Verified', tone: 'success' });
  });

  it('returns null instead of "Invalid Date"', () => {
    expect(formatLeadDate(undefined)).toBeNull();
    expect(formatLeadDate('not a date')).toBeNull();
    expect(formatLeadDate('2026-10-14T10:00:00.000Z')).toContain('2026');
  });
});
