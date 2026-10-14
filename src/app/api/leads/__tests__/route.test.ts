/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';

// Runs against a real in-memory MongoDB: the filters are aggregation stages, so
// mocks would prove nothing about them.
let mongod: MongoMemoryServer;
let GET: typeof import('../route').GET;
let DELETE: typeof import('../route').DELETE;
let LeadIngestion: typeof import('@/lib/db/models/LeadIngestion').LeadIngestion;
let Client: typeof import('@/lib/db/models/Client').Client;
let Campaign: typeof import('@/lib/db/models/Campaign').Campaign;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  ({ GET, DELETE } = await import('../route'));
  ({ LeadIngestion } = await import('@/lib/db/models/LeadIngestion'));
  ({ Client } = await import('@/lib/db/models/Client'));
  ({ Campaign } = await import('@/lib/db/models/Campaign'));
  const { connectToMongoDB } = await import('@/lib/db/connection');
  await connectToMongoDB();
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await Promise.all([
    LeadIngestion.deleteMany({}),
    Client.deleteMany({}),
    Campaign.deleteMany({}),
  ]);
});

type LeadSeed = Partial<Record<string, unknown>>;

async function seedClient(name = 'Jane Doe #01') {
  return Client.create({ baseName: name.replace(/ #\d+$/, ''), name, serialNumber: 1 });
}

async function seedLead(clientId: mongoose.Types.ObjectId, overrides: LeadSeed = {}) {
  return LeadIngestion.create({
    clientId,
    rawText: 'Pasted profile text',
    fullName: 'Jane Doe',
    ...overrides,
  });
}

async function get(query: string) {
  const response = await GET(new NextRequest(`http://localhost/api/leads${query}`));
  return { status: response.status, body: await response.json() };
}

async function del(init: { id?: string; ids?: string[] }) {
  const url = init.id
    ? `http://localhost/api/leads?id=${init.id}`
    : 'http://localhost/api/leads';
  const request = new NextRequest(url, {
    method: 'DELETE',
    ...(init.ids ? { body: JSON.stringify({ ids: init.ids }) } : {}),
  });
  const response = await DELETE(request);
  return { status: response.status, body: await response.json() };
}

describe('GET /api/leads pagination', () => {
  it('pages through results and reports the real total', async () => {
    const client = await seedClient();
    for (let i = 0; i < 5; i += 1) {
      await seedLead(client._id as mongoose.Types.ObjectId, { fullName: `Lead ${i}` });
    }

    const first = await get('?limit=2&page=1');
    expect(first.status).toBe(200);
    expect(first.body.leads).toHaveLength(2);
    expect(first.body.total).toBe(5);
    expect(first.body.pages).toBe(3);
    expect(first.body.hasMore).toBe(true);

    const last = await get('?limit=2&page=3');
    expect(last.body.leads).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
  });

  it('clamps a limit above the maximum instead of loading everything', async () => {
    const { body } = await get('?limit=100000');
    expect(body.limit).toBe(200);
  });

  it('falls back to defaults for junk paging values', async () => {
    const { body } = await get('?limit=abc&page=-4');
    expect(body.limit).toBe(100);
    expect(body.page).toBe(1);
  });
});

describe('GET /api/leads card view', () => {
  it('leaves out the heavy fields and resolves the LinkedIn URL', async () => {
    const client = await seedClient();
    await seedLead(client._id as mongoose.Types.ObjectId, {
      rawText: 'Profile: https://www.linkedin.com/in/jane-doe/, reach out soon',
      emailBody: '<p>Long draft</p>',
      currentCompanies: [{ companyName: 'Acme', jobTitle: 'CTO', companyEmails: ['hi@acme.com'] }],
    });

    const { body } = await get('?view=cards');
    const [lead] = body.leads;
    expect(lead.rawText).toBeUndefined();
    expect(lead.emailBody).toBeUndefined();
    // The trailing comma must not end up inside the link.
    expect(lead.rawLinkedinUrl).toBe('https://www.linkedin.com/in/jane-doe/,');
    expect(lead.currentCompanies[0]).toMatchObject({ companyName: 'Acme', approved: false });
    expect(lead.clientName).toBe('Jane Doe #01');
  });

  it('returns a null client name rather than inventing one', async () => {
    const orphanClientId = new mongoose.Types.ObjectId();
    await seedLead(orphanClientId);
    const { body } = await get('?view=cards');
    expect(body.leads[0].clientName).toBeNull();
  });
});

describe('GET /api/leads search', () => {
  it('requires every word to match, across fields', async () => {
    const client = await seedClient();
    await seedLead(client._id as mongoose.Types.ObjectId, { fullName: 'John Smith' });
    await seedLead(client._id as mongoose.Types.ObjectId, { fullName: 'John Baker' });

    expect((await get('?search=john%20smith')).body.total).toBe(1);
    expect((await get('?search=john')).body.total).toBe(2);
  });

  it('matches the company name and company emails', async () => {
    const client = await seedClient();
    await seedLead(client._id as mongoose.Types.ObjectId, {
      fullName: 'Ana Ruiz',
      currentCompanies: [{ companyName: 'Northwind', companyEmails: ['hello@northwind.io'] }],
    });

    expect((await get('?search=northwind')).body.total).toBe(1);
    expect((await get('?search=hello@northwind.io')).body.total).toBe(1);
  });

  it('does not match words that only appear in the pasted profile text', async () => {
    const client = await seedClient();
    await seedLead(client._id as mongoose.Types.ObjectId, {
      fullName: 'Ana Ruiz',
      rawText: 'the quick brown fox mentions everything',
    });
    expect((await get('?search=quick')).body.total).toBe(0);
  });

  it('treats regex characters as plain text', async () => {
    const client = await seedClient();
    await seedLead(client._id as mongoose.Types.ObjectId, { fullName: 'Ana (Ruiz)' });
    expect((await get('?search=' + encodeURIComponent('(Ruiz)'))).body.total).toBe(1);
  });
});

describe('GET /api/leads date range', () => {
  it('filters on the instants it is given, not the server day', async () => {
    const client = await seedClient();
    const old = await seedLead(client._id as mongoose.Types.ObjectId, { fullName: 'Older' });
    // createdAt is immutable through Mongoose, so backdate it on the collection.
    await LeadIngestion.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date('2026-01-01T00:00:00.000Z') } }
    );
    await seedLead(client._id as mongoose.Types.ObjectId, { fullName: 'Fresh' });

    const recent = await get(`?from=${encodeURIComponent('2026-06-01T00:00:00.000Z')}`);
    expect(recent.body.total).toBe(1);
    expect(recent.body.leads[0].fullName).toBe('Fresh');

    const window = await get(
      `?from=${encodeURIComponent('2025-12-31T00:00:00.000Z')}&to=${encodeURIComponent('2026-01-02T00:00:00.000Z')}`
    );
    expect(window.body.total).toBe(1);
    expect(window.body.leads[0].fullName).toBe('Older');
  });

  it('rejects a broken range instead of ignoring it', async () => {
    expect((await get('?from=notadate')).status).toBe(400);
    expect(
      (await get(`?from=${encodeURIComponent('2027-01-01')}&to=${encodeURIComponent('2020-01-01')}`))
        .status
    ).toBe(400);
  });

  it('rejects a malformed client id', async () => {
    expect((await get('?clientId=not-an-id')).status).toBe(400);
  });
});

describe('GET /api/leads status filters', () => {
  const verified = (email: string) => ({ email, status: 'valid' as const });

  async function seedStatusFixtures() {
    const client = await seedClient();
    const clientId = client._id as mongoose.Types.ObjectId;

    // Everything verified, nothing approved.
    await seedLead(clientId, {
      fullName: 'Ready Rita',
      email: 'rita@mail.com',
      verifiedEmails: [verified('rita@mail.com'), verified('info@acme.com')],
      currentCompanies: [{ companyName: 'Acme', companyEmails: ['info@acme.com'], approved: false }],
    });
    // Personal verified, but one company has no verified email.
    await seedLead(clientId, {
      fullName: 'Partial Pete',
      email: 'pete@mail.com',
      verifiedEmails: [verified('pete@mail.com')],
      currentCompanies: [{ companyName: 'Globex', companyEmails: ['sales@globex.com'] }],
    });
    // Verified but already approved.
    await seedLead(clientId, {
      fullName: 'Approved Amy',
      email: 'amy@mail.com',
      approved: true,
      verifiedEmails: [verified('amy@mail.com')],
      currentCompanies: [],
    });
    // No email at all.
    await seedLead(clientId, { fullName: 'Empty Eli', email: null, currentCompanies: [] });
    return clientId;
  }

  it('"verified & not approved" needs every box verified and nothing approved', async () => {
    await seedStatusFixtures();
    const { body } = await get('?emailStatus=unapproved_verified_smtp');
    expect(body.leads.map((l: { fullName: string }) => l.fullName)).toEqual(['Ready Rita']);
    expect(body.total).toBe(1);
  });

  it('"missing or unverified" catches any box with a gap', async () => {
    await seedStatusFixtures();
    const { body } = await get('?emailStatus=missing_or_unverified');
    expect(body.leads.map((l: { fullName: string }) => l.fullName).sort()).toEqual([
      'Empty Eli',
      'Partial Pete',
    ]);
  });

  it('counts risky as sendable, like the sending code does', async () => {
    const client = await seedClient();
    await seedLead(client._id as mongoose.Types.ObjectId, {
      fullName: 'Risky Rick',
      email: 'rick@mail.com',
      verifiedEmails: [{ email: 'rick@mail.com', status: 'risky' }],
      currentCompanies: [],
    });
    const { body } = await get('?emailStatus=unapproved_verified_smtp');
    expect(body.total).toBe(1);
  });

  it('filters by client and by approval', async () => {
    const clientA = await seedClient('Client A #01');
    const clientB = await seedClient('Client B #01');
    await seedLead(clientA._id as mongoose.Types.ObjectId, { fullName: 'A lead', approved: true });
    await seedLead(clientB._id as mongoose.Types.ObjectId, { fullName: 'B lead' });

    expect((await get(`?clientId=${clientA._id}`)).body.total).toBe(1);
    expect((await get('?approved=true')).body.total).toBe(1);
    expect((await get('?approved=false')).body.total).toBe(1);
  });
});

describe('DELETE /api/leads', () => {
  it('removes the lead, its campaign items and the client left empty', async () => {
    const client = await seedClient();
    const clientId = client._id as mongoose.Types.ObjectId;
    const lead = await seedLead(clientId, { fullName: 'Doomed Dan' });
    const keeper = await seedLead(clientId, { fullName: 'Keeper Kim' });

    const campaign = await Campaign.create({
      name: 'October push',
      status: 'running',
      totalEmails: 2,
      items: [
        {
          leadId: lead._id,
          companyIndex: -1,
          candidateName: 'Doomed Dan',
          clientName: 'Jane Doe #01',
          companyName: 'Acme',
          recipientEmail: 'dan@acme.com',
          subject: 'Hi',
          bodyHtml: '<p>Hi</p>',
          status: 'pending',
        },
        {
          leadId: keeper._id,
          companyIndex: -1,
          candidateName: 'Keeper Kim',
          clientName: 'Jane Doe #01',
          companyName: 'Globex',
          recipientEmail: 'kim@globex.com',
          subject: 'Hi',
          bodyHtml: '<p>Hi</p>',
          status: 'delivered',
        },
      ],
    });

    const { status, body } = await del({ id: String(lead._id) });
    expect(status).toBe(200);
    expect(body).toMatchObject({ deletedCount: 1, removedCampaignItems: 1, removedClients: 0 });

    const updated = await Campaign.findById(campaign._id);
    expect(updated?.items).toHaveLength(1);
    expect(updated?.totalEmails).toBe(1);
    expect(updated?.deliveredCount).toBe(1);
    // Nothing is queued any more, so the run is finished.
    expect(updated?.status).toBe('completed');

    // The client still owns Keeper Kim, so it stays.
    expect(await Client.countDocuments({})).toBe(1);

    const second = await del({ ids: [String(keeper._id)] });
    expect(second.body.removedClients).toBe(1);
    expect(await Client.countDocuments({})).toBe(0);
  });

  it('refuses malformed and empty id lists, and reports unknown ids', async () => {
    expect((await del({ id: 'abc' })).status).toBe(422);
    expect((await del({ ids: [] })).status).toBe(422);
    expect((await del({})).status).toBe(422);
    expect((await del({ id: String(new mongoose.Types.ObjectId()) })).status).toBe(404);
  });

  it('counts each lead once when an id is repeated', async () => {
    const client = await seedClient();
    const lead = await seedLead(client._id as mongoose.Types.ObjectId);
    const { body } = await del({ ids: [String(lead._id), String(lead._id)] });
    expect(body.deletedCount).toBe(1);
  });
});
