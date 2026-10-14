/** @jest-environment node */
jest.mock('@/lib/db/connection', () => ({ connectToMongoDB: jest.fn().mockResolvedValue(undefined) }));

jest.mock('@/lib/db/models/Client', () => ({
  Client: {
    findById: jest.fn(() => ({
      select: () => ({ lean: () => Promise.resolve({ name: 'Abdul Wadood #24' }) }),
    })),
  },
}));

jest.mock('@/services/lead-ingestion/smtpVerifier', () => ({ verifyEmailSmtp: jest.fn() }));
jest.mock('@/lib/db/models/LeadIngestion', () => ({ LeadIngestion: { findById: jest.fn() } }));

jest.mock('mongoose', () => ({
  Types: { ObjectId: { isValid: (id: string) => id !== 'bad-id' } },
  models: {},
  model: jest.fn(),
  Schema: class {},
}));

import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { verifyEmailSmtp } from '@/services/lead-ingestion/smtpVerifier';
import { DraftWriteError, mutateDraftEmail, normalizeSubject, patchDraft } from '../draftWrites';

const mockFindById = LeadIngestion.findById as unknown as jest.Mock;
const mockVerifyEmailSmtp = verifyEmailSmtp as unknown as jest.Mock;

interface FakeCompany {
  companyName: string;
  jobTitle?: string;
  emailSubject?: string | null;
  emailBody?: string | null;
  companyEmails?: string[];
  approved?: boolean;
  inCampaign?: boolean;
  campaignSendStatus?: string | null;
  websiteUrl?: string | null;
  summary?: string;
}

function fakeDoc(overrides: Record<string, unknown> = {}) {
  const doc = {
    _id: 'lead1',
    clientId: 'client1',
    fullName: 'Abdul Wadood',
    summary: 'A founder.',
    email: 'abdul@gmail.com',
    discoveredEmails: ['abdul@gmail.com'],
    verifiedEmails: [{ email: 'abdul@gmail.com', status: 'valid' }],
    emailValidationStatus: 'valid',
    emailSubject: 'Personal subject',
    emailBody: '<p>Personal body</p>',
    approved: false,
    inCampaign: false,
    campaignSendStatus: null,
    emailStatus: 'pending',
    portfolioUrl: null,
    currentCompanies: [
      {
        companyName: 'MantiqSoft',
        jobTitle: 'CEO',
        emailSubject: 'Company subject',
        emailBody: '<p>Company body</p>',
        companyEmails: ['info@mantiqsoft.com'],
        approved: false,
        inCampaign: true,
        campaignSendStatus: 'delivered',
        websiteUrl: 'https://mantiqsoft.com',
        summary: 'Runs delivery.',
      } as FakeCompany,
      {
        companyName: 'Second Co',
        emailSubject: 'Second subject',
        emailBody: '<p>Second body</p>',
        companyEmails: ['hi@second.com'],
        approved: false,
        inCampaign: false,
        campaignSendStatus: null,
      } as FakeCompany,
    ],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    markModified: jest.fn(),
    save: jest.fn(),
    toObject() {
      return { ...this };
    },
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  mockFindById.mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockVerifyEmailSmtp.mockResolvedValue({ status: 'valid', reasons: [] });
});

describe('normalizeSubject', () => {
  it('flattens to one plain line and caps the length', () => {
    expect(normalizeSubject('  <b>Hello</b>\n there  ')).toBe('Hello there');
    expect(normalizeSubject('x'.repeat(400))).toHaveLength(350);
  });
});

describe('patchDraft', () => {
  it('updates only the targeted box and keeps campaign state of the others', async () => {
    const doc = fakeDoc();
    await patchDraft('lead1', 1, { subject: 'New subject', bodyHtml: '<p>New body</p>' });

    const [first, second] = doc.currentCompanies as FakeCompany[];
    expect(second.emailSubject).toBe('New subject');
    expect(second.emailBody).toBe('<p>New body</p>');
    // the box the user did not touch is untouched, campaign state included
    expect(first).toMatchObject({
      emailSubject: 'Company subject',
      inCampaign: true,
      campaignSendStatus: 'delivered',
    });
    expect(doc.save).toHaveBeenCalled();
  });

  it('sanitizes the body before storing it', async () => {
    const doc = fakeDoc();
    await patchDraft('lead1', -1, { bodyHtml: '<p>Hi<script>alert(1)</script></p><img src=x onerror=alert(1)>' });
    expect(doc.emailBody).not.toContain('script');
    expect(doc.emailBody).not.toContain('onerror');
    expect(doc.emailBody).toContain('<p>Hi</p>');
  });

  it('refuses to approve while an address is unverified', async () => {
    fakeDoc({ verifiedEmails: [{ email: 'abdul@gmail.com', status: 'pending' }] });
    await expect(patchDraft('lead1', -1, { approved: true })).rejects.toMatchObject({ status: 409 });
  });

  it('approves when every address of the box is sendable', async () => {
    const doc = fakeDoc();
    const detail = await patchDraft('lead1', -1, { approved: true });
    expect(doc.approved).toBe(true);
    expect(detail).toMatchObject({ approved: true, companyIndex: -1, clientName: 'Abdul Wadood #24' });
  });

  it('refuses to edit a box that is already in a campaign', async () => {
    fakeDoc();
    await expect(patchDraft('lead1', 0, { subject: 'nope' })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects an unknown lead or company box', async () => {
    fakeDoc();
    await expect(patchDraft('lead1', 7, { subject: 'x' })).rejects.toBeInstanceOf(DraftWriteError);
    mockFindById.mockResolvedValueOnce(null);
    await expect(patchDraft('lead1', -1, { subject: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('mutateDraftEmail', () => {
  it('runs a real SMTP verification for a company address', async () => {
    mockVerifyEmailSmtp.mockResolvedValue({ status: 'risky', reasons: [] });
    const doc = fakeDoc();

    const { status, detail } = await mutateDraftEmail('lead1', 1, 'verify', 'hi@second.com');

    expect(mockVerifyEmailSmtp).toHaveBeenCalledWith('hi@second.com');
    expect(status).toBe('risky');
    expect(detail.emails).toEqual([{ email: 'hi@second.com', status: 'risky' }]);
    expect(doc.verifiedEmails).toContainEqual({ email: 'hi@second.com', status: 'risky' });
  });

  it('adds and verifies a new address', async () => {
    const doc = fakeDoc();
    const { detail } = await mutateDraftEmail('lead1', 1, 'add', ' Sales@Second.com ');
    expect((doc.currentCompanies as FakeCompany[])[1].companyEmails).toEqual(['hi@second.com', 'sales@second.com']);
    expect(detail.emails.map((entry) => entry.email)).toEqual(['hi@second.com', 'sales@second.com']);
  });

  it('rejects an invalid address and a duplicate', async () => {
    fakeDoc();
    await expect(mutateDraftEmail('lead1', 1, 'add', 'not-an-email')).rejects.toMatchObject({ status: 400 });
    await expect(mutateDraftEmail('lead1', 1, 'add', 'HI@second.com')).rejects.toMatchObject({ status: 409 });
  });

  it('removes an address, repoints the personal primary and prunes its status', async () => {
    const doc = fakeDoc({
      discoveredEmails: ['abdul@gmail.com', 'second@gmail.com'],
      verifiedEmails: [
        { email: 'abdul@gmail.com', status: 'valid' },
        { email: 'second@gmail.com', status: 'valid' },
      ],
    });

    await mutateDraftEmail('lead1', -1, 'remove', 'abdul@gmail.com');

    expect(doc.discoveredEmails).toEqual(['second@gmail.com']);
    expect(doc.email).toBe('second@gmail.com');
    expect(doc.verifiedEmails).toEqual([{ email: 'second@gmail.com', status: 'valid' }]);
  });

  it('un-approves a box when a replacement address is not verified', async () => {
    mockVerifyEmailSmtp.mockResolvedValue({ status: 'invalid', reasons: [] });
    const doc = fakeDoc({ approved: true });

    const { detail } = await mutateDraftEmail('lead1', -1, 'replace', 'abdul@gmail.com', 'new@gmail.com');

    expect(doc.approved).toBe(false);
    expect(detail.approved).toBe(false);
    expect(detail.emails).toEqual([{ email: 'new@gmail.com', status: 'invalid' }]);
  });

  it('keeps the draft usable when the verifier throws', async () => {
    fakeDoc();
    mockVerifyEmailSmtp.mockRejectedValue(new Error('port 25 blocked'));
    const { status } = await mutateDraftEmail('lead1', -1, 'verify', 'abdul@gmail.com');
    expect(status).toBe('unknown');
  });

  it('refuses to touch contacts of a box in a campaign', async () => {
    fakeDoc();
    await expect(mutateDraftEmail('lead1', 0, 'remove', 'info@mantiqsoft.com')).rejects.toMatchObject({
      status: 409,
    });
  });
});
