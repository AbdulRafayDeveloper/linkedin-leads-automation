/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { getDashboardStats } from '../dashboardStats';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Campaign } from '@/lib/db/models/Campaign';

let mongod: MongoMemoryServer;

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-14T12:00:00Z');
const WEEK = { from: at('2026-09-08T00:00:00Z'), to: NOW, timeZone: 'UTC', now: NOW };

function lead(createdAt: string, fields: Record<string, unknown> = {}) {
  return {
    clientId: new mongoose.Types.ObjectId(),
    rawText: 'profile',
    fullName: 'Lead',
    status: 'completed',
    crawlStatus: 'completed',
    email: null,
    discoveredEmails: [],
    discoveredPhones: [],
    verifiedEmails: [],
    currentCompanies: [],
    emailSubject: null,
    emailBody: null,
    approved: false,
    createdAt: at(createdAt),
    updatedAt: at(createdAt),
    ...fields,
  };
}

function item(status: string, dates: Record<string, string> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    leadId: new mongoose.Types.ObjectId(),
    companyIndex: 0,
    candidateName: 'Lead',
    clientName: 'Lead #01',
    companyName: 'Acme',
    recipientEmail: 'to@acme.com',
    subject: 'Hi',
    bodyHtml: '<p>Hi</p>',
    status,
    ...Object.fromEntries(Object.entries(dates).map(([k, v]) => [k, at(v)])),
  };
}

function campaign(name: string, status: string, items: ReturnType<typeof item>[], updatedAt = '2026-09-13T10:00:00Z') {
  return {
    name,
    status,
    totalEmails: items.length,
    createdAt: at('2026-09-01T00:00:00Z'),
    updatedAt: at(updatedAt),
    items,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  await connectToMongoDB();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([LeadIngestion.deleteMany({}), Campaign.deleteMany({})]);
});

describe('emails are counted once', () => {
  it('counts a shared address once, at its strongest verification', async () => {
    await LeadIngestion.collection.insertMany([
      lead('2026-09-10T10:00:00Z', {
        fullName: 'One',
        discoveredEmails: ['Info@Acme.com'],
        verifiedEmails: [{ email: 'info@acme.com', status: 'valid' }],
      }),
      lead('2026-09-11T10:00:00Z', {
        fullName: 'Two',
        // The same mailbox, never checked on this lead and spelled differently.
        currentCompanies: [{ companyName: 'Acme', companyEmails: ['INFO@acme.com'] }],
      }),
    ]);

    const stats = await getDashboardStats(WEEK);
    expect(stats.kpis.emailsFound.value).toBe(1);
    expect(stats.verification).toEqual({ valid: 1, risky: 0, invalid: 0, unknown: 0, pending: 0 });
    // The verification panel's total is the same number as the KPI.
    const total = Object.values(stats.verification).reduce((a, b) => a + b, 0);
    expect(total).toBe(stats.kpis.emailsFound.value);
  });
});

describe('research', () => {
  it('does not count placeholder company boxes as companies', async () => {
    await LeadIngestion.collection.insertMany([
      lead('2026-09-10T10:00:00Z', {
        currentCompanies: [
          { companyName: 'Acme', websiteUrl: 'https://acme.com', companyEmails: [] },
          { companyName: 'Unspecified Company', websiteUrl: null, companyEmails: [] },
          { companyName: '   ', websiteUrl: null, companyEmails: [] },
        ],
      }),
    ]);

    const stats = await getDashboardStats(WEEK);
    expect(stats.research.companies).toBe(1);
    expect(stats.research.withWebsite).toBe(1);
  });
});

describe('drafts add up', () => {
  it('counts an unapproved draft as awaiting review even when it is queued', async () => {
    await LeadIngestion.collection.insertMany([
      lead('2026-09-10T10:00:00Z', {
        emailSubject: 'Hi',
        emailBody: '<p>Hi</p>',
        approved: false,
        inCampaign: true,
        currentCompanies: [
          // In a campaign but with no draft of its own: not a draft.
          { companyName: 'Acme', companyEmails: [], inCampaign: true },
          { companyName: 'Globex', companyEmails: [], emailSubject: 'Hi', emailBody: '<p>Hi</p>', approved: true },
        ],
      }),
    ]);

    const stats = await getDashboardStats(WEEK);
    expect(stats.drafts).toEqual({ written: 2, awaitingReview: 1, approved: 1, inCampaign: 1 });
    expect(stats.drafts.written).toBe(stats.drafts.approved + stats.drafts.awaitingReview);
  });
});

describe('comparison window', () => {
  it('uses the window the browser asked for', async () => {
    await LeadIngestion.collection.insertMany([
      lead('2026-09-10T10:00:00Z', { fullName: 'In range' }),
      lead('2026-09-03T10:00:00Z', { fullName: 'In the chosen comparison' }),
      lead('2026-09-06T10:00:00Z', { fullName: 'Outside it' }),
    ]);

    const stats = await getDashboardStats({
      ...WEEK,
      compare: { from: at('2026-09-02T00:00:00Z'), to: at('2026-09-04T00:00:00Z') },
    });

    expect(stats.kpis.leads).toEqual({ value: 1, previous: 1 });
    expect(stats.range.comparison).toEqual({
      from: '2026-09-02T00:00:00.000Z',
      to: '2026-09-04T00:00:00.000Z',
    });
  });
});

describe('sending activity', () => {
  it('leaves an undated failure out of a period but counts it all time', async () => {
    await Campaign.collection.insertMany([
      campaign('Undated', 'completed', [item('failed'), item('failed', { failedAt: '2026-09-12T10:00:00Z' })]),
    ]);

    const ranged = await getDashboardStats(WEEK);
    expect(ranged.delivery.failed).toBe(1);

    const allTime = await getDashboardStats({ timeZone: 'UTC', now: NOW });
    expect(allTime.delivery.failed).toBe(2);
  });

  it('counts a delivered email with no send date in the all-time total', async () => {
    await Campaign.collection.insertMany([
      campaign('Legacy', 'completed', [item('delivered'), item('delivered', { sentAt: '2026-09-11T10:00:00Z' })]),
    ]);

    expect((await getDashboardStats({ timeZone: 'UTC', now: NOW })).kpis.sent.value).toBe(2);
    // Inside a period, only the one that can be placed in time counts.
    expect((await getDashboardStats(WEEK)).kpis.sent.value).toBe(1);
  });

  it('reports the queue across every campaign, whatever the range', async () => {
    await Campaign.collection.insertMany([
      campaign('A', 'running', [item('pending'), item('sending')]),
      campaign('B', 'draft', [item('pending')], '2026-01-01T00:00:00Z'),
    ]);

    expect((await getDashboardStats(WEEK)).delivery.queued).toBe(3);
    expect((await getDashboardStats({ timeZone: 'UTC', now: NOW })).delivery.queued).toBe(3);
  });

  it('bases the open rate on the emails sent in the period', async () => {
    await Campaign.collection.insertMany([
      campaign('Opens', 'completed', [
        item('opened', { sentAt: '2026-09-10T10:00:00Z', openedAt: '2026-09-10T12:00:00Z' }),
        item('delivered', { sentAt: '2026-09-11T10:00:00Z' }),
      ]),
    ]);

    const stats = await getDashboardStats(WEEK);
    expect(stats.delivery.delivered).toBe(2);
    expect(stats.delivery.openRate).toBeCloseTo(0.5);
  });
});

describe('all-time range', () => {
  it('stretches to a lead dated in the future so it still lands on the chart', async () => {
    await LeadIngestion.collection.insertMany([
      lead('2026-09-10T10:00:00Z'),
      lead('2026-09-20T10:00:00Z', { fullName: 'Clock skew' }),
    ]);

    const stats = await getDashboardStats({ timeZone: 'UTC', now: NOW });
    expect(new Date(stats.range.to).getTime()).toBeGreaterThanOrEqual(at('2026-09-20T10:00:00Z').getTime());
    const charted = stats.series.reduce((sum, point) => sum + point.leads, 0);
    expect(charted).toBe(2);
  });

  it('says when the workspace is empty', async () => {
    const stats = await getDashboardStats({ timeZone: 'UTC', now: NOW });
    expect(stats.hasAnyData).toBe(false);
    expect(stats.kpis.leads.value).toBe(0);
    expect(stats.series.length).toBeGreaterThan(0);
  });
});

describe('long ranges', () => {
  it('switches to weekly buckets and keeps the chart short', async () => {
    await LeadIngestion.collection.insertMany([
      lead('2026-06-15T10:00:00Z'),
      lead('2026-06-16T10:00:00Z'),
      lead('2026-09-10T10:00:00Z'),
    ]);

    const stats = await getDashboardStats({
      from: at('2026-05-01T00:00:00Z'),
      to: NOW,
      timeZone: 'UTC',
      now: NOW,
    });

    expect(stats.range.granularity).toBe('week');
    expect(stats.series.length).toBeLessThanOrEqual(21);
    expect(stats.series.reduce((sum, point) => sum + point.leads, 0)).toBe(3);
    // Both June leads fall in the same week bucket.
    const june = stats.series.find((point) => point.key === '2026-06-15');
    expect(june?.leads).toBe(2);
  });
});
