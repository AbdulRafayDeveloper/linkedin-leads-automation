/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { SENDING_TIMEOUT_MS } from '@/services/lead-ingestion/campaignRunner';

jest.mock('@/services/lead-ingestion/mailer', () => ({
  sendOutboundEmail: jest.fn(),
}));

import { sendOutboundEmail } from '@/services/lead-ingestion/mailer';

type ListRoute = typeof import('../route');
type DetailRoute = typeof import('../[id]/route');
type DispatchRoute = typeof import('../[id]/dispatch-batch/route');

let mongod: MongoMemoryServer;
let list: ListRoute;
let detail: DetailRoute;
let dispatch: DispatchRoute;
let Campaign: typeof import('@/lib/db/models/Campaign').Campaign;
let LeadIngestion: typeof import('@/lib/db/models/LeadIngestion').LeadIngestion;
let Client: typeof import('@/lib/db/models/Client').Client;

const sendMock = jest.mocked(sendOutboundEmail);

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { connectToMongoDB } = await import('@/lib/db/connection');
  await connectToMongoDB();
  list = await import('../route');
  detail = await import('../[id]/route');
  dispatch = await import('../[id]/dispatch-batch/route');
  ({ Campaign } = await import('@/lib/db/models/Campaign'));
  ({ LeadIngestion } = await import('@/lib/db/models/LeadIngestion'));
  ({ Client } = await import('@/lib/db/models/Client'));
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({ success: true, messageId: 'id' });
  delete process.env.ENABLE_OPEN_TRACKING;
});

afterEach(async () => {
  await Promise.all([Campaign.deleteMany({}), LeadIngestion.deleteMany({}), Client.deleteMany({})]);
});

const BASE = 'http://localhost:3000/api/campaigns';

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function json(res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper reads arbitrary JSON
  return (await res.json()) as Record<string, any>;
}

async function makeLead(overrides: Record<string, unknown> = {}) {
  const client = await Client.create({ baseName: 'Ada Lovelace', name: 'Ada Lovelace #01', serialNumber: 1 });
  return LeadIngestion.create({
    clientId: client._id,
    rawText: 'raw',
    fullName: 'Ada Lovelace',
    companyName: 'Analytical Engines',
    email: 'ada@example.com',
    emailSubject: 'Personal subject',
    emailBody: '<p>Hi Ada,</p><p>Personal body</p>',
    currentCompanies: [
      {
        companyName: 'Analytical Engines',
        websiteUrl: 'https://ae.example',
        companyEmails: ['hello@ae.example'],
        emailSubject: 'Company subject',
        emailBody: '<p>Hi Ada,</p><p>Company body</p>',
        approved: true,
      },
    ],
    ...overrides,
  });
}

function fullItem(leadId: unknown, companyIndex: number, email: string) {
  return {
    leadId: String(leadId),
    companyIndex,
    candidateName: 'Ada Lovelace',
    clientName: 'Ada Lovelace #01',
    companyName: 'Analytical Engines',
    recipientEmail: email,
    subject: 'Subject',
    bodyHtml: '<p>Hi Ada,</p>',
  };
}

async function createCampaign(items: unknown[], extra: Record<string, unknown> = {}) {
  const res = await list.POST(req(BASE, { method: 'POST', body: { name: 'October', items, ...extra } }));
  const body = await json(res);
  return { res, body };
}

describe('POST /api/campaigns', () => {
  it('rejects a missing name and an empty item list with 422', async () => {
    const lead = await makeLead();
    let res = await list.POST(req(BASE, { method: 'POST', body: { name: '  ', items: [fullItem(lead._id, -1, 'ada@example.com')] } }));
    expect(res.status).toBe(422);
    res = await list.POST(req(BASE, { method: 'POST', body: { name: 'x', items: [] } }));
    expect(res.status).toBe(422);
  });

  it('rejects an invalid lead id and a bad email with 422 instead of crashing', async () => {
    let { res, body } = await createCampaign([fullItem('not-an-id', -1, 'ada@example.com')]);
    expect(res.status).toBe(422);
    expect(body.error).toMatch(/Invalid lead id/);
    const lead = await makeLead();
    ({ res, body } = await createCampaign([fullItem(lead._id, -1, 'nope')]));
    expect(res.status).toBe(422);
    expect(body.error).toMatch(/email/i);
  });

  it('rejects the same draft selected twice', async () => {
    const lead = await makeLead();
    const { res, body } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com'), fullItem(lead._id, -1, 'ada@example.com')]);
    expect(res.status).toBe(422);
    expect(body.error).toMatch(/twice/);
  });

  it('fills names, subject and body from the lead when the client only sends ids', async () => {
    const lead = await makeLead();
    const { res, body } = await createCampaign([
      { leadId: String(lead._id), companyIndex: 0, recipientEmail: 'hello@ae.example' },
      { leadId: String(lead._id), companyIndex: -1, recipientEmail: 'ADA@example.com' },
    ]);
    expect(res.status).toBe(201);
    const [company, personal] = body.campaign.items;
    expect(company.subject).toBe('Company subject');
    expect(company.bodyHtml).toContain('Company body');
    expect(company.companyName).toBe('Analytical Engines');
    expect(company.clientName).toBe('Ada Lovelace #01');
    expect(personal.subject).toBe('Personal subject');
    expect(personal.recipientEmail).toBe('ada@example.com');
    // The personal draft is labelled with the lead's current company.
    expect(personal.companyName).toBe('Analytical Engines');
  });

  it('refuses a box with no saved draft', async () => {
    const lead = await makeLead({ emailSubject: null, emailBody: null });
    const { res, body } = await createCampaign([{ leadId: String(lead._id), companyIndex: -1, recipientEmail: 'ada@example.com' }]);
    expect(res.status).toBe(422);
    expect(body.error).toMatch(/No email draft/);
  });

  it('always creates a draft, normalizes an inverted delay range and flags the lead boxes', async () => {
    const lead = await makeLead();
    const { res, body } = await createCampaign(
      [fullItem(lead._id, -1, 'ada@example.com'), fullItem(lead._id, 0, 'hello@ae.example')],
      { status: 'running', minDelaySeconds: 300, maxDelaySeconds: 30 }
    );
    expect(res.status).toBe(201);
    expect(body.campaign.status).toBe('draft');
    expect(body.campaign.minDelaySeconds).toBe(30);
    expect(body.campaign.maxDelaySeconds).toBe(300);
    expect(body.campaign.pendingCount).toBe(2);

    const doc = await LeadIngestion.findById(lead._id);
    expect(doc?.inCampaign).toBe(true);
    expect(doc?.campaignSendStatus).toBe('pending');
    expect(doc?.emailStatus).toBe('in_progress');
    expect(doc?.currentCompanies[0].inCampaign).toBe(true);
  });

  it('refuses a draft that is already in another campaign with 409', async () => {
    const lead = await makeLead();
    await createCampaign([fullItem(lead._id, -1, 'ada@example.com')]);
    const { res, body } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com')]);
    expect(res.status).toBe(409);
    expect(body.error).toContain('ada@example.com');
    expect(await Campaign.countDocuments()).toBe(1);
  });
});

describe('GET /api/campaigns', () => {
  async function seed(n: number) {
    const docs = [];
    for (let i = 0; i < n; i++) {
      docs.push({
        name: `Campaign ${String(i).padStart(2, '0')}`,
        status: i % 2 === 0 ? 'draft' : 'completed',
        items: [{ ...fullItem(new mongoose.Types.ObjectId(), -1, `p${i}@example.com`), leadId: new mongoose.Types.ObjectId(), status: 'delivered' }],
        createdAt: new Date(2026, 0, i + 1),
      });
    }
    await Campaign.insertMany(docs);
  }

  it('paginates, caps the page size and never returns item bodies', async () => {
    await seed(25);
    let body = await json(await list.GET(req(`${BASE}?page=2&limit=10`)));
    expect(body.campaigns).toHaveLength(10);
    expect(body.total).toBe(25);
    expect(body.pages).toBe(3);
    expect(body.hasMore).toBe(true);
    expect(body.campaigns[0].items).toBeUndefined();
    expect(body.campaigns[0].deliveredCount).toBe(1);
    expect(typeof body.openTrackingEnabled).toBe('boolean');

    body = await json(await list.GET(req(`${BASE}?limit=100000`)));
    expect(body.limit).toBe(100);
  });

  it('filters by status, escapes regex characters in search and rejects unknown statuses', async () => {
    await seed(4);
    await Campaign.create({ name: 'Q4 (vip) .*', items: [] });
    let body = await json(await list.GET(req(`${BASE}?status=completed`)));
    expect(body.total).toBe(2);
    body = await json(await list.GET(req(`${BASE}?search=${encodeURIComponent('(vip) .*')}`)));
    expect(body.total).toBe(1);
    expect(body.campaigns[0].name).toBe('Q4 (vip) .*');
    const res = await list.GET(req(`${BASE}?status=bogus`));
    expect(res.status).toBe(422);
  });

  it('sorts by name case-insensitively when asked', async () => {
    await Campaign.insertMany([{ name: 'beta', items: [] }, { name: 'Alpha', items: [] }, { name: 'gamma', items: [] }]);
    const body = await json(await list.GET(req(`${BASE}?sort=name&order=asc`)));
    expect(body.campaigns.map((c: { name: string }) => c.name)).toEqual(['Alpha', 'beta', 'gamma']);
    expect(body.sort).toBe('name');
    expect(body.order).toBe('asc');
  });

  it('repairs a campaign whose runner disappeared before listing it', async () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await Campaign.create({
      name: 'Abandoned',
      status: 'running',
      maxDelaySeconds: 60,
      runnerHeartbeatAt: longAgo,
      items: [{ ...fullItem(new mongoose.Types.ObjectId(), -1, 'a@example.com'), leadId: new mongoose.Types.ObjectId(), status: 'pending' }],
    });
    const body = await json(await list.GET(req(BASE)));
    expect(body.campaigns[0].status).toBe('paused');
    expect(body.campaigns[0].isRunnerActive).toBe(false);
  });
});

describe('GET / PUT / DELETE /api/campaigns/[id]', () => {
  it('validates the id and returns 404 for a missing campaign', async () => {
    expect((await detail.GET(req(`${BASE}/nope`), params('nope'))).status).toBe(400);
    const missing = new mongoose.Types.ObjectId().toString();
    expect((await detail.GET(req(`${BASE}/${missing}`), params(missing))).status).toBe(404);
    expect((await detail.DELETE(req(`${BASE}/${missing}`, { method: 'DELETE' }), params(missing))).status).toBe(404);
  });

  it('returns the campaign with its items and the tracking flag', async () => {
    const lead = await makeLead();
    const { body: created } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com')]);
    const id = created.campaign._id;
    const body = await json(await detail.GET(req(`${BASE}/${id}`), params(id)));
    expect(body.campaign.items).toHaveLength(1);
    expect(body.openTrackingEnabled).toBe(false);
  });

  it('updates name and delays, normalizes the range and refuses status running', async () => {
    const lead = await makeLead();
    const { body: created } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com')]);
    const id = created.campaign._id;

    let res = await detail.PUT(req(`${BASE}/${id}`, { method: 'PUT', body: { name: '  Renamed  ', minDelaySeconds: 500, maxDelaySeconds: 20 } }), params(id));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.campaign.name).toBe('Renamed');
    expect(body.campaign.minDelaySeconds).toBe(20);
    expect(body.campaign.maxDelaySeconds).toBe(500);

    res = await detail.PUT(req(`${BASE}/${id}`, { method: 'PUT', body: { status: 'running' } }), params(id));
    expect(res.status).toBe(422);

    res = await detail.PUT(req(`${BASE}/${id}`, { method: 'PUT', body: { name: '' } }), params(id));
    expect(res.status).toBe(422);
  });

  it('turns a pause with nothing left to send into completed', async () => {
    const lead = await makeLead();
    const { body: created } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com')]);
    const id = created.campaign._id;
    await dispatch.POST(req(`${BASE}/${id}/dispatch-batch`, { method: 'POST', body: { runnerId: 'tab-a' } }), params(id));
    const body = await json(await detail.PUT(req(`${BASE}/${id}`, { method: 'PUT', body: { status: 'paused', runnerId: 'tab-a' } }), params(id)));
    expect(body.campaign.status).toBe('completed');
  });

  it('refuses to delete while another tab is actively sending, then deletes and frees unsent drafts', async () => {
    const lead = await makeLead();
    const { body: created } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com'), fullItem(lead._id, 0, 'hello@ae.example')]);
    const id = created.campaign._id;

    // One email goes out: the campaign is now running with a fresh heartbeat.
    await dispatch.POST(req(`${BASE}/${id}/dispatch-batch`, { method: 'POST', body: { runnerId: 'tab-a' } }), params(id));

    let res = await detail.DELETE(req(`${BASE}/${id}`, { method: 'DELETE' }), params(id));
    expect(res.status).toBe(409);

    res = await detail.DELETE(req(`${BASE}/${id}?force=true`, { method: 'DELETE' }), params(id));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.releasedDrafts).toBe(1);

    const doc = await LeadIngestion.findById(lead._id);
    // Personal box was delivered: stays flagged. Company box was pending: released.
    expect(doc?.inCampaign).toBe(true);
    expect(doc?.currentCompanies[0].inCampaign).toBe(false);
    expect(doc?.currentCompanies[0].campaignSendStatus).toBeNull();
    expect(await Campaign.countDocuments()).toBe(0);
  });
});

describe('POST /api/campaigns/[id]/dispatch-batch', () => {
  const send = (id: string, body: Record<string, unknown> = { runnerId: 'tab-a' }) =>
    dispatch.POST(req(`${BASE}/${id}/dispatch-batch`, { method: 'POST', body }), params(id));

  async function twoItemCampaign() {
    const lead = await makeLead();
    const { body } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com'), fullItem(lead._id, 0, 'hello@ae.example')]);
    return { id: body.campaign._id as string, lead };
  }

  it('sends exactly one pending email per call and reports what is left', async () => {
    const { id, lead } = await twoItemCampaign();

    let body = await json(await send(id));
    expect(body.processedCount).toBe(1);
    expect(body.successCount).toBe(1);
    expect(body.remainingCount).toBe(1);
    expect(body.item.status).toBe('delivered');
    expect(body.item.attempts).toBe(1);
    expect(body.campaign.status).toBe('running');
    expect(body.campaign.isRunnerActive).toBe(true);
    expect(body.campaign.deliveredCount).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe('ada@example.com');

    const leadDoc = await LeadIngestion.findById(lead._id);
    expect(leadDoc?.campaignSendStatus).toBe('delivered');
    expect(leadDoc?.emailStatus).toBe('delivered');

    body = await json(await send(id));
    expect(body.remainingCount).toBe(0);
    expect(body.campaign.status).toBe('completed');
    expect(body.campaign.activeRunnerId).toBeNull();

    body = await json(await send(id));
    expect(body.processedCount).toBe(0);
    expect(body.remainingCount).toBe(0);
    expect(body.message).toMatch(/Nothing left/);
  });

  it('records failures with a timestamp and counts them as remaining only when retrying', async () => {
    const { id } = await twoItemCampaign();
    sendMock.mockResolvedValueOnce({ success: false, error: 'SMTP down' });

    let body = await json(await send(id));
    expect(body.failedCount).toBe(1);
    expect(body.item.status).toBe('failed');
    expect(body.item.errorMessage).toBe('SMTP down');
    expect(body.item.failedAt).toBeTruthy();
    expect(body.remainingCount).toBe(1); // the other pending item

    body = await json(await send(id));
    expect(body.campaign.status).toBe('completed');
    expect(body.campaign.failedCount).toBe(1);

    // Plain mode has nothing to do; it points at Retry failed.
    body = await json(await send(id));
    expect(body.processedCount).toBe(0);
    expect(body.message).toMatch(/Retry failed/);

    // Retry mode resends the failed one, clears the failure and reports 0 remaining.
    body = await json(await send(id, { runnerId: 'tab-a', rerunFailed: true }));
    expect(body.processedCount).toBe(1);
    expect(body.item.status).toBe('delivered');
    expect(body.item.failedAt).toBeNull();
    expect(body.item.errorMessage).toBeNull();
    expect(body.item.attempts).toBe(2);
    expect(body.remainingCount).toBe(0);
    expect(body.campaign.failedCount).toBe(0);
  });

  it('keeps counting failed items as remaining while retrying several', async () => {
    const { id } = await twoItemCampaign();
    sendMock.mockResolvedValue({ success: false, error: 'boom' });
    await send(id);
    await send(id);
    sendMock.mockResolvedValue({ success: true, messageId: 'ok' });

    const body = await json(await send(id, { runnerId: 'tab-a', rerunFailed: true }));
    expect(body.processedCount).toBe(1);
    expect(body.remainingCount).toBe(1); // one failed item still to retry
    expect(body.campaign.status).toBe('completed');
  });

  it('sends only the requested item when itemIds is given', async () => {
    const { id } = await twoItemCampaign();
    const doc = await Campaign.findById(id);
    const second = doc!.items[1]._id!.toString();
    const body = await json(await send(id, { runnerId: 'tab-a', itemIds: [second] }));
    expect(body.item._id).toBe(second);
    expect(body.remainingCount).toBe(0);
    expect(sendMock.mock.calls[0][0].to).toBe('hello@ae.example');
    expect((await Campaign.findById(id))!.items[0].status).toBe('pending');
  });

  it('blocks a second tab while the first is active unless it takes over', async () => {
    const { id } = await twoItemCampaign();
    await send(id, { runnerId: 'tab-a' });

    let res = await send(id, { runnerId: 'tab-b' });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/another tab/);

    res = await send(id, { runnerId: 'tab-b', takeover: true });
    expect(res.status).toBe(200);
    const taken = await json(res);
    expect(taken.processedCount).toBe(1);
    // That was the last email, so the lock is released again.
    expect(taken.campaign.status).toBe('completed');
    expect(taken.campaign.activeRunnerId).toBeNull();
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('never sends the same email twice when two requests overlap', async () => {
    const { id } = await twoItemCampaign();
    sendMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ success: true, messageId: 'slow' }), 150)));

    const [a, b] = await Promise.all([send(id), send(id)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const doc = await Campaign.findById(id);
    expect(doc!.items.filter((i) => i.status === 'delivered')).toHaveLength(1);
    expect(doc!.items.filter((i) => i.status === 'sending')).toHaveLength(0);
  });

  it('turns an item stuck in sending into a failure the runner can retry', async () => {
    const { id } = await twoItemCampaign();
    const longAgo = new Date(Date.now() - SENDING_TIMEOUT_MS - 1000);
    await Campaign.updateOne({ _id: id }, { $set: { 'items.0.status': 'sending', 'items.0.sendingStartedAt': longAgo } });

    const body = await json(await send(id));
    const doc = await Campaign.findById(id);
    expect(doc!.items[0].status).toBe('failed');
    expect(doc!.items[0].errorMessage).toMatch(/Timed out/);
    // The call still sent the other pending item.
    expect(body.processedCount).toBe(1);
    expect(body.item.recipientEmail).toBe('hello@ae.example');
  });

  it('adds the tracking pixel only when open tracking is on', async () => {
    const { id } = await twoItemCampaign();
    await send(id);
    expect(sendMock.mock.calls[0][0].htmlBody).not.toContain('/track?');

    process.env.ENABLE_OPEN_TRACKING = 'true';
    await send(id);
    expect(sendMock.mock.calls[1][0].htmlBody).toContain(`/track?campaignId=${id}&itemId=`);
  });

  it('does not flip a paused campaign to running when there is nothing to send', async () => {
    const lead = await makeLead();
    const { body: created } = await createCampaign([fullItem(lead._id, -1, 'ada@example.com')]);
    const id = created.campaign._id;
    await Campaign.updateOne({ _id: id }, { $set: { status: 'paused', 'items.0.status': 'failed' } });
    const body = await json(await send(id));
    expect(body.processedCount).toBe(0);
    expect(body.campaign.status).toBe('completed');
  });
});
