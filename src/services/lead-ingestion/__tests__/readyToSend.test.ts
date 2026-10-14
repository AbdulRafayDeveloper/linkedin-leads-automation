import {
  draftEmailCandidates,
  isDraftQueued,
  isDraftReady,
  parseDelayRange,
  readyToSendQuery,
  verificationStatusFor,
} from '../readyToSend';

describe('isDraftReady / isDraftQueued', () => {
  const ready = { approved: true, emailSubject: 'Hi', emailBody: '<p>Hello</p>' };

  it('is ready when approved with a subject and body and not in a campaign', () => {
    expect(isDraftReady(ready)).toBe(true);
    expect(isDraftReady({ ...ready, inCampaign: false, campaignSendStatus: null })).toBe(true);
  });

  it('is not ready without approval, subject or body', () => {
    expect(isDraftReady({ ...ready, approved: false })).toBe(false);
    expect(isDraftReady({ ...ready, approved: undefined })).toBe(false);
    expect(isDraftReady({ ...ready, emailSubject: '   ' })).toBe(false);
    expect(isDraftReady({ ...ready, emailBody: null })).toBe(false);
  });

  it('is queued when the box is flagged inCampaign or carries a campaign send status', () => {
    expect(isDraftQueued({ inCampaign: true })).toBe(true);
    for (const status of ['pending', 'sending', 'delivered', 'opened', 'failed']) {
      expect(isDraftQueued({ campaignSendStatus: status })).toBe(true);
      expect(isDraftReady({ ...ready, campaignSendStatus: status })).toBe(false);
    }
    expect(isDraftQueued({ inCampaign: false, campaignSendStatus: null })).toBe(false);
    expect(isDraftQueued({})).toBe(false);
  });
});

describe('readyToSendQuery', () => {
  it('matches a ready personal draft or a ready company box, never a queued one', () => {
    const query = readyToSendQuery() as { $or: Record<string, unknown>[] };
    expect(query.$or).toHaveLength(2);
    expect(query.$or[0]).toMatchObject({
      approved: true,
      inCampaign: { $ne: true },
      campaignSendStatus: { $nin: ['pending', 'sending', 'delivered', 'opened', 'failed'] },
    });
    expect(query.$or[1]).toMatchObject({
      currentCompanies: { $elemMatch: { approved: true, inCampaign: { $ne: true } } },
    });
  });
});

describe('draftEmailCandidates', () => {
  const lead = {
    email: 'Jane@Example.com',
    discoveredEmails: ['jane@example.com', 'hello@example.com', 'not-an-email', ''],
    currentCompanies: [{ companyEmails: ['Info@Acme.io', 'info@acme.io', 'sales@acme.io'] }, {}],
  };

  it('returns the personal address first, lowercased and deduplicated, for the personal draft', () => {
    expect(draftEmailCandidates(lead, -1)).toEqual(['jane@example.com', 'hello@example.com']);
  });

  it('returns the company box addresses for a company draft', () => {
    expect(draftEmailCandidates(lead, 0)).toEqual(['info@acme.io', 'sales@acme.io']);
    expect(draftEmailCandidates(lead, 1)).toEqual([]);
    expect(draftEmailCandidates(lead, 5)).toEqual([]);
  });
});

describe('verificationStatusFor', () => {
  const lead = {
    email: 'jane@example.com',
    emailValidationStatus: 'risky',
    verifiedEmails: [{ email: 'Info@Acme.io', status: 'valid' }],
  };

  it('matches verified entries case-insensitively', () => {
    expect(verificationStatusFor(lead, 'info@acme.io')).toBe('valid');
    expect(verificationStatusFor(lead, 'INFO@ACME.IO')).toBe('valid');
  });

  it('falls back to the lead-level status for the personal email and to pending otherwise', () => {
    expect(verificationStatusFor(lead, 'jane@example.com')).toBe('risky');
    expect(verificationStatusFor(lead, 'nobody@example.com')).toBe('pending');
    expect(verificationStatusFor(lead, '')).toBe('pending');
  });
});

describe('parseDelayRange', () => {
  it('accepts whole seconds in range with min <= max, from numbers or strings', () => {
    expect(parseDelayRange(60, 600)).toEqual({ ok: true, min: 60, max: 600 });
    expect(parseDelayRange('5', ' 3600 ')).toEqual({ ok: true, min: 5, max: 3600 });
    expect(parseDelayRange(30, 30)).toEqual({ ok: true, min: 30, max: 30 });
  });

  it('rejects blanks, decimals, negatives, out-of-range values and an inverted range', () => {
    expect(parseDelayRange('', 600).ok).toBe(false);
    expect(parseDelayRange('1.5', 600).ok).toBe(false);
    expect(parseDelayRange('-5', 600).ok).toBe(false);
    expect(parseDelayRange(1, 600).ok).toBe(false);
    expect(parseDelayRange(60, 3601).ok).toBe(false);
    expect(parseDelayRange(600, 60)).toEqual({
      ok: false,
      error: 'Minimum delay cannot be greater than maximum delay.',
    });
  });
});
