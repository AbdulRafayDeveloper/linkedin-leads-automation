/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import {
  countItems,
  isRunnerActive,
  leadBoxUpdate,
  recomputeCounters,
  repairStaleCampaigns,
  releaseUndeliveredLeadBoxes,
  findAlreadyQueued,
  serializeCampaign,
  SENDING_TIMEOUT_MESSAGE,
} from '../campaignService';
import { RUNNER_GRACE_MS, SENDING_TIMEOUT_MS } from '../campaignRunner';
import type { CampaignItem } from '@/lib/db/models/Campaign';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { connectToMongoDB } = await import('@/lib/db/connection');
  await connectToMongoDB();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const { Campaign } = await import('@/lib/db/models/Campaign');
  const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
  await Campaign.deleteMany({});
  await LeadIngestion.deleteMany({});
});

function item(status: CampaignItem['status'], overrides: Partial<CampaignItem> = {}): CampaignItem {
  return {
    leadId: new mongoose.Types.ObjectId(),
    companyIndex: -1,
    candidateName: 'Ada',
    clientName: 'Ada #01',
    companyName: 'Personal',
    recipientEmail: 'ada@example.com',
    subject: 'Hi',
    bodyHtml: '<p>Hi Ada,</p>',
    status,
    ...overrides,
  };
}

describe('countItems', () => {
  it('counts every status and the total', () => {
    expect(countItems([item('pending'), item('pending'), item('sending'), item('delivered'), item('opened'), item('failed')])).toEqual({
      total: 6,
      pending: 2,
      sending: 1,
      delivered: 1,
      opened: 1,
      failed: 1,
    });
  });

  it('handles an empty or missing list', () => {
    expect(countItems(undefined).total).toBe(0);
    expect(countItems([]).total).toBe(0);
  });
});

describe('isRunnerActive', () => {
  const now = new Date('2026-10-14T12:00:00Z');

  it('is false unless the campaign is running', () => {
    expect(isRunnerActive({ status: 'paused', runnerHeartbeatAt: now, maxDelaySeconds: 60 }, now)).toBe(false);
    expect(isRunnerActive({ status: 'completed', runnerHeartbeatAt: now, maxDelaySeconds: 60 }, now)).toBe(false);
  });

  it('is true while the heartbeat is within max delay plus grace', () => {
    const heartbeat = new Date(now.getTime() - 60_000 - RUNNER_GRACE_MS + 1000);
    expect(isRunnerActive({ status: 'running', runnerHeartbeatAt: heartbeat, maxDelaySeconds: 60 }, now)).toBe(true);
  });

  it('is false once the heartbeat is older than max delay plus grace', () => {
    const heartbeat = new Date(now.getTime() - 60_000 - RUNNER_GRACE_MS - 1000);
    expect(isRunnerActive({ status: 'running', runnerHeartbeatAt: heartbeat, maxDelaySeconds: 60 }, now)).toBe(false);
  });

  it('falls back to updatedAt for documents written before heartbeats existed', () => {
    expect(isRunnerActive({ status: 'running', runnerHeartbeatAt: null, updatedAt: now, maxDelaySeconds: 60 }, now)).toBe(true);
    expect(isRunnerActive({ status: 'running', runnerHeartbeatAt: null, maxDelaySeconds: 60 }, now)).toBe(false);
  });
});

describe('serializeCampaign', () => {
  it('derives every count from the items and strips bodies when asked', () => {
    const out = serializeCampaign(
      {
        _id: new mongoose.Types.ObjectId(),
        name: 'Test',
        status: 'running',
        totalEmails: 999,
        items: [item('delivered'), item('opened'), item('failed'), item('pending')],
        minDelaySeconds: 10,
        maxDelaySeconds: 20,
        runnerHeartbeatAt: new Date(),
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      { includeItems: false }
    );
    expect(out.totalEmails).toBe(4);
    expect(out.deliveredCount).toBe(2);
    expect(out.sentCount).toBe(2);
    expect(out.openedCount).toBe(1);
    expect(out.failedCount).toBe(1);
    expect(out.pendingCount).toBe(1);
    expect(out.isRunnerActive).toBe(true);
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.items).toBeUndefined();
  });

  it('includes serialized items by default', () => {
    const out = serializeCampaign({
      _id: 'abc',
      name: 'Test',
      status: 'draft',
      items: [item('pending', { sentAt: null })],
    });
    expect(out.items).toHaveLength(1);
    expect(out.items?.[0].sentAt).toBeNull();
    expect(out.items?.[0].attempts).toBe(0);
  });
});

describe('leadBoxUpdate', () => {
  it('targets the personal box for companyIndex -1', () => {
    const op = leadBoxUpdate(item('pending'), { inCampaign: true, campaignSendStatus: 'pending', emailStatus: 'in_progress' });
    expect(op).toMatchObject({
      updateOne: { update: { $set: { inCampaign: true, campaignSendStatus: 'pending', emailStatus: 'in_progress' } } },
    });
  });

  it('targets the company box for companyIndex >= 0 and never touches emailStatus', () => {
    const op = leadBoxUpdate(item('pending', { companyIndex: 2 }), { inCampaign: false, campaignSendStatus: null, emailStatus: 'pending' });
    expect(op).toMatchObject({
      updateOne: { update: { $set: { 'currentCompanies.2.inCampaign': false, 'currentCompanies.2.campaignSendStatus': null } } },
    });
    expect(JSON.stringify(op)).not.toContain('emailStatus');
  });

  it('returns null for an impossible index', () => {
    expect(leadBoxUpdate(item('pending', { companyIndex: -5 }), { inCampaign: true, campaignSendStatus: 'pending' })).toBeNull();
  });
});

describe('repairStaleCampaigns (database)', () => {
  it('turns timed-out sending items into failed ones and pauses a campaign whose runner vanished', async () => {
    const { Campaign } = await import('@/lib/db/models/Campaign');
    const longAgo = new Date(Date.now() - SENDING_TIMEOUT_MS - 60_000);
    const created = await Campaign.create({
      name: 'Stuck',
      status: 'running',
      minDelaySeconds: 10,
      maxDelaySeconds: 20,
      runnerHeartbeatAt: longAgo,
      items: [item('sending', { sendingStartedAt: longAgo }), item('sending', { sendingStartedAt: null }), item('pending')],
    });

    await repairStaleCampaigns();

    const doc = await Campaign.findById(created._id);
    expect(doc?.status).toBe('paused');
    expect(doc?.activeRunnerId).toBeNull();
    expect(doc?.items.map((i) => i.status)).toEqual(['failed', 'failed', 'pending']);
    expect(doc?.items[0].errorMessage).toBe(SENDING_TIMEOUT_MESSAGE);
    expect(doc?.items[0].failedAt).toBeInstanceOf(Date);
  });

  it('completes a stale running campaign that has nothing left to send', async () => {
    const { Campaign } = await import('@/lib/db/models/Campaign');
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    const created = await Campaign.create({
      name: 'Done',
      status: 'running',
      maxDelaySeconds: 20,
      runnerHeartbeatAt: longAgo,
      items: [item('delivered'), item('failed')],
    });
    await repairStaleCampaigns();
    expect((await Campaign.findById(created._id))?.status).toBe('completed');
  });

  it('leaves a fresh sending item and an active runner alone', async () => {
    const { Campaign } = await import('@/lib/db/models/Campaign');
    const created = await Campaign.create({
      name: 'Live',
      status: 'running',
      maxDelaySeconds: 20,
      runnerHeartbeatAt: new Date(),
      items: [item('sending', { sendingStartedAt: new Date() }), item('pending')],
    });
    await repairStaleCampaigns();
    const doc = await Campaign.findById(created._id);
    expect(doc?.status).toBe('running');
    expect(doc?.items[0].status).toBe('sending');
  });
});

describe('lead box helpers (database)', () => {
  async function makeLead() {
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    return LeadIngestion.create({
      clientId: new mongoose.Types.ObjectId(),
      rawText: 'raw',
      fullName: 'Ada',
      inCampaign: true,
      campaignSendStatus: 'pending',
      emailStatus: 'in_progress',
      currentCompanies: [
        { companyName: 'Acme', inCampaign: true, campaignSendStatus: 'delivered' },
        { companyName: 'Beta', inCampaign: true, campaignSendStatus: 'pending' },
      ],
    });
  }

  it('releaseUndeliveredLeadBoxes frees pending and failed boxes but keeps delivered ones', async () => {
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const lead = await makeLead();
    const released = await releaseUndeliveredLeadBoxes([
      item('pending', { leadId: lead._id as mongoose.Types.ObjectId, companyIndex: -1 }),
      item('delivered', { leadId: lead._id as mongoose.Types.ObjectId, companyIndex: 0 }),
      item('failed', { leadId: lead._id as mongoose.Types.ObjectId, companyIndex: 1 }),
    ]);
    expect(released).toBe(2);
    const doc = await LeadIngestion.findById(lead._id);
    expect(doc?.inCampaign).toBe(false);
    expect(doc?.campaignSendStatus).toBeNull();
    expect(doc?.emailStatus).toBe('pending');
    expect(doc?.currentCompanies[0].inCampaign).toBe(true);
    expect(doc?.currentCompanies[1].inCampaign).toBe(false);
  });

  it('findAlreadyQueued names recipients whose box is already in a campaign', async () => {
    const lead = await makeLead();
    const clashes = await findAlreadyQueued([
      { leadId: lead._id as mongoose.Types.ObjectId, companyIndex: -1, recipientEmail: 'ada@example.com' },
      { leadId: lead._id as mongoose.Types.ObjectId, companyIndex: 1, recipientEmail: 'hello@beta.com' },
      { leadId: new mongoose.Types.ObjectId(), companyIndex: -1, recipientEmail: 'ghost@example.com' },
    ]);
    expect(clashes).toEqual(['ada@example.com', 'hello@beta.com']);
  });
});

describe('recomputeCounters', () => {
  it('writes derived counters onto the document', async () => {
    const { Campaign } = await import('@/lib/db/models/Campaign');
    const doc = new Campaign({ name: 'x', items: [item('delivered'), item('opened'), item('failed'), item('pending')] });
    const counts = recomputeCounters(doc);
    expect(counts.total).toBe(4);
    expect(doc.totalEmails).toBe(4);
    expect(doc.deliveredCount).toBe(2);
    expect(doc.sentCount).toBe(2);
    expect(doc.openedCount).toBe(1);
    expect(doc.failedCount).toBe(1);
  });
});
