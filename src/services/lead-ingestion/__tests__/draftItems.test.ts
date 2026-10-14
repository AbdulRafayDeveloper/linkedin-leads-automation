/** @jest-environment node */
import {
  approvalEligibility,
  buildDraftItems,
  countDraftItems,
  draftItemsOfLead,
  filterDraftItems,
  matchesSmtpFilter,
  parseSendStatusFilter,
  parseSmtpFilter,
  type DraftSourceLead,
} from '../draftItems';

function lead(overrides: Partial<DraftSourceLead> = {}): DraftSourceLead {
  return {
    _id: 'lead1',
    clientId: 'client1',
    fullName: 'Abdul Wadood',
    emailSubject: 'Personal subject',
    emailBody: '<p>Personal body</p>',
    email: 'abdul@gmail.com',
    discoveredEmails: ['abdul@gmail.com'],
    verifiedEmails: [{ email: 'abdul@gmail.com', status: 'valid' }],
    approved: false,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-02T10:00:00Z'),
    currentCompanies: [],
    ...overrides,
  };
}

describe('draftItemsOfLead', () => {
  it('builds one item per written draft and skips boxes without a draft', () => {
    const items = draftItemsOfLead(
      lead({
        currentCompanies: [
          {
            companyName: 'MantiqSoft',
            jobTitle: 'CEO',
            emailSubject: 'Company subject',
            emailBody: '<p>Company body</p>',
            companyEmails: ['info@mantiqsoft.com'],
          },
          { companyName: 'No draft yet', emailSubject: '', emailBody: '' },
        ],
      }),
      'Abdul Wadood #24'
    );

    expect(items.map((item) => item.companyIndex)).toEqual([-1, 0]);
    expect(items[0]).toMatchObject({
      id: 'lead1:-1',
      serial: '#24',
      clientName: 'Abdul Wadood #24',
      targetEmail: 'abdul@gmail.com',
      smtpStatus: 'valid',
      sendStatus: 'pending',
    });
    expect(items[1]).toMatchObject({ id: 'lead1:0', companyName: 'MantiqSoft', emailCount: 1 });
  });

  it('never lets a sent personal email change a company box status', () => {
    const items = draftItemsOfLead(
      lead({
        emailStatus: 'delivered',
        campaignSendStatus: 'delivered',
        currentCompanies: [
          {
            companyName: 'MantiqSoft',
            emailSubject: 'S',
            emailBody: '<p>B</p>',
            companyEmails: ['info@mantiqsoft.com'],
          },
        ],
      })
    );

    expect(items.find((item) => item.companyIndex === -1)?.sendStatus).toBe('delivered');
    expect(items.find((item) => item.companyIndex === 0)?.sendStatus).toBe('pending');
  });

  it('matches verified addresses case-insensitively', () => {
    const items = draftItemsOfLead(
      lead({
        discoveredEmails: ['Abdul@Gmail.com'],
        verifiedEmails: [{ email: 'abdul@gmail.com', status: 'risky' }],
      })
    );
    expect(items[0].smtpStatus).toBe('risky');
  });

  it('marks a box with no address as no_contact_email', () => {
    const items = draftItemsOfLead(lead({ email: null, discoveredEmails: [] }));
    expect(items[0]).toMatchObject({ targetEmail: null, smtpStatus: null, sendStatus: 'no_contact_email' });
  });

  it('de-duplicates addresses that differ only by case', () => {
    const items = draftItemsOfLead(lead({ discoveredEmails: ['a@x.com', 'A@X.com', 'b@x.com'] }));
    expect(items[0].emailCount).toBe(2);
  });
});

describe('filters', () => {
  const items = buildDraftItems(
    [
      lead({ _id: 'l1', approved: true }),
      lead({ _id: 'l2', approved: false, verifiedEmails: [{ email: 'abdul@gmail.com', status: 'pending' }] }),
      lead({ _id: 'l3', approved: false, verifiedEmails: [{ email: 'abdul@gmail.com', status: 'invalid' }] }),
      lead({ _id: 'l4', approved: false, email: null, discoveredEmails: [] }),
    ],
    new Map([['client1', 'Client #1']])
  );

  it('separates approved from draft at item level', () => {
    expect(filterDraftItems(items, { approval: 'approved', smtp: 'all', sendStatus: 'all' })).toHaveLength(1);
    expect(filterDraftItems(items, { approval: 'draft', smtp: 'all', sendStatus: 'all' })).toHaveLength(3);
  });

  it('splits SMTP status into verified, unverified, invalid and missing', () => {
    const smtpOf = (filter: Parameters<typeof matchesSmtpFilter>[1]) =>
      filterDraftItems(items, { approval: 'all', smtp: filter, sendStatus: 'all' }).map((item) => item.leadId);

    expect(smtpOf('valid')).toEqual(['l1']);
    expect(smtpOf('unverified')).toEqual(['l2']);
    expect(smtpOf('invalid')).toEqual(['l3']);
    expect(smtpOf('no_contact_email')).toEqual(['l4']);
  });

  it('treats risky as sendable, like campaign dispatch does', () => {
    const [risky] = buildDraftItems(
      [lead({ verifiedEmails: [{ email: 'abdul@gmail.com', status: 'risky' }] })],
      new Map()
    );
    expect(matchesSmtpFilter(risky, 'valid')).toBe(true);
    expect(matchesSmtpFilter(risky, 'unverified')).toBe(false);
  });

  it('counts every bucket exactly once', () => {
    expect(countDraftItems(items)).toEqual({
      total: 4,
      approved: 1,
      draft: 3,
      valid: 1,
      unverified: 1,
      invalid: 1,
      no_contact_email: 1,
    });
  });
});

describe('approvalEligibility', () => {
  it('needs at least one address', () => {
    expect(approvalEligibility([])).toMatchObject({ ok: false });
  });

  it('blocks when any address is not sendable and names it', () => {
    const result = approvalEligibility([
      { email: 'a@x.com', status: 'valid' },
      { email: 'b@x.com', status: 'pending' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('b@x.com');
  });

  it('passes when every address is valid or risky', () => {
    expect(
      approvalEligibility([
        { email: 'a@x.com', status: 'valid' },
        { email: 'b@x.com', status: 'risky' },
      ])
    ).toEqual({ ok: true, reason: null });
  });
});

describe('filter parsers', () => {
  it('falls back to "all" for unknown values', () => {
    expect(parseSmtpFilter('bogus')).toBe('all');
    expect(parseSmtpFilter('unverified')).toBe('unverified');
    expect(parseSendStatusFilter(null)).toBe('all');
    expect(parseSendStatusFilter('delivered')).toBe('delivered');
  });
});
