/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { getDashboardStats, summarizeLeads } from '../dashboardStats';
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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  await connectToMongoDB();

  // Raw inserts so the test controls createdAt exactly.
  await LeadIngestion.collection.insertMany([
    lead('2026-09-10T10:00:00Z', {
      fullName: 'Ada Lovelace',
      email: 'ada@gmail.com',
      discoveredEmails: ['ada@gmail.com'],
      discoveredPhones: ['+1 555 0100'],
      verifiedEmails: [
        { email: 'ada@gmail.com', status: 'valid' },
        { email: 'info@acme.com', status: 'risky' },
      ],
      emailSubject: 'Personal',
      emailBody: '<p>Hi</p>',
      currentCompanies: [
        {
          companyName: 'Acme',
          websiteUrl: 'https://acme.com',
          companyEmails: ['info@acme.com'],
          emailSubject: 'Company',
          emailBody: '<p>Hi</p>',
          approved: true,
          inCampaign: true,
          campaignSendStatus: 'delivered',
        },
      ],
    }),
    lead('2026-09-12T08:00:00Z', {
      fullName: 'Blaise Pascal',
      crawlStatus: 'failed',
      currentCompanies: [{ companyName: 'Beta', websiteUrl: null, companyEmails: [] }],
    }),
    lead('2026-09-13T09:00:00Z', {
      fullName: 'Carl Gauss',
      email: 'carl@corp.io',
      discoveredEmails: ['carl@corp.io', 'sales@corp.io'],
      verifiedEmails: [{ email: 'carl@corp.io', status: 'invalid' }],
    }),
    lead('2026-09-05T10:00:00Z', { fullName: 'Previous Week' }),
    lead('2026-08-01T10:00:00Z', { fullName: 'Last Month' }),
  ]);

  await Campaign.collection.insertMany([
    {
      name: 'September push',
      status: 'running',
      totalEmails: 5,
      createdAt: at('2026-09-02T00:00:00Z'),
      updatedAt: at('2026-09-13T10:00:00Z'),
      items: [
        item('delivered', { sentAt: '2026-09-11T10:00:00Z' }),
        item('opened', { sentAt: '2026-09-12T10:00:00Z', openedAt: '2026-09-12T12:00:00Z' }),
        item('failed', { failedAt: '2026-09-13T10:00:00Z' }),
        item('pending'),
        item('delivered', { sentAt: '2026-09-03T10:00:00Z' }),
      ],
    },
    {
      name: 'August',
      status: 'completed',
      totalEmails: 1,
      createdAt: at('2026-08-01T00:00:00Z'),
      updatedAt: at('2026-08-01T10:00:00Z'),
      items: [item('delivered', { sentAt: '2026-08-01T10:00:00Z' })],
    },
  ]);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('getDashboardStats for a date range', () => {
  it('counts leads, emails and verification for leads imported in the range', async () => {
    const stats = await getDashboardStats(WEEK);

    expect(stats.kpis.leads).toEqual({ value: 3, previous: 1 });
    expect(stats.kpis.emailsFound).toEqual({ value: 4, previous: 0 });
    expect(stats.kpis.verified).toEqual({ value: 2, previous: 0 });
    expect(stats.verification).toEqual({ valid: 1, risky: 1, invalid: 1, unknown: 0, pending: 1 });
  });

  it('builds the lead funnel', async () => {
    const stats = await getDashboardStats(WEEK);
    expect(Object.fromEntries(stats.funnel.map((s) => [s.key, s.value]))).toEqual({
      imported: 3,
      email_found: 2,
      verified: 1,
      drafted: 1,
      approved: 1,
      contacted: 1,
    });
  });

  it('counts drafts and research per email box', async () => {
    const stats = await getDashboardStats(WEEK);
    expect(stats.drafts).toEqual({ written: 2, awaitingReview: 1, approved: 1, inCampaign: 1 });
    expect(stats.research).toEqual({ companies: 2, withWebsite: 1, leadsWithPhone: 1, crawlsFailed: 1 });
  });

  it('counts sending activity by when it happened', async () => {
    const stats = await getDashboardStats(WEEK);
    expect(stats.kpis.sent).toEqual({ value: 2, previous: 1 });
    expect(stats.kpis.opened).toEqual({ value: 1, previous: 0 });
    expect(stats.delivery).toMatchObject({ delivered: 2, opened: 1, failed: 1, queued: 1 });
    expect(stats.delivery.deliveryRate).toBeCloseTo(2 / 3);
    expect(stats.delivery.openRate).toBeCloseTo(0.5);
    expect(stats.campaigns).toMatchObject({ running: 1, completed: 1, paused: 0, draft: 0 });
    expect(stats.campaigns.recent[0]).toMatchObject({ name: 'September push', processed: 4, delivered: 3, failed: 1 });
  });

  it('returns one bucket per day with activity in the right day', async () => {
    const stats = await getDashboardStats(WEEK);
    expect(stats.range.granularity).toBe('day');
    expect(stats.series).toHaveLength(7);
    const byDay = Object.fromEntries(stats.series.map((p) => [p.key, [p.leads, p.sent, p.opened]]));
    expect(byDay['2026-09-10']).toEqual([1, 0, 0]);
    expect(byDay['2026-09-11']).toEqual([0, 1, 0]);
    expect(byDay['2026-09-12']).toEqual([1, 1, 1]);
    expect(byDay['2026-09-13']).toEqual([1, 0, 0]);
  });

  it('lists the newest leads first with their stage', async () => {
    const stats = await getDashboardStats(WEEK);
    expect(stats.recentLeads.map((l) => [l.fullName, l.stage])).toEqual([
      ['Carl Gauss', 'email_found'],
      ['Blaise Pascal', 'imported'],
      ['Ada Lovelace', 'contacted'],
    ]);
  });
});

describe('summarizeLeads', () => {
  it('does not count a lead as having an email just because it has a draft', () => {
    const { funnel } = summarizeLeads([
      {
        _id: 'x',
        fullName: 'No Email',
        companyName: null,
        createdAt: NOW,
        status: 'completed',
        crawlStatus: 'completed',
        email: null,
        hasPersonalDraft: true,
        companies: [],
      },
    ]);
    expect(Object.fromEntries(funnel.map((s) => [s.key, s.value]))).toMatchObject({
      imported: 1,
      email_found: 0,
      verified: 0,
      drafted: 1,
    });
  });
});

describe('getDashboardStats for all time', () => {
  it('covers everything and has no comparison', async () => {
    const stats = await getDashboardStats({ timeZone: 'UTC', now: NOW });
    expect(stats.range.isAllTime).toBe(true);
    expect(stats.range.from).toBe('2026-08-01T00:00:00.000Z');
    expect(stats.kpis.leads).toEqual({ value: 5, previous: null });
    expect(stats.kpis.sent).toEqual({ value: 4, previous: null });
    expect(stats.trackingEnabled).toBe(false);
  });
});
