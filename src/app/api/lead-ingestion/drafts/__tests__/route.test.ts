/** @jest-environment node */
jest.mock('@/lib/db/connection', () => ({ connectToMongoDB: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/db/models/LeadIngestion', () => ({ LeadIngestion: { find: jest.fn(), countDocuments: jest.fn() } }));
jest.mock('@/lib/db/models/Client', () => ({ Client: { find: jest.fn() } }));

import { NextRequest } from 'next/server';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Client } from '@/lib/db/models/Client';
import { GET } from '../route';

const mockFind = LeadIngestion.find as unknown as jest.Mock;
const mockCount = LeadIngestion.countDocuments as unknown as jest.Mock;
const mockClientFind = Client.find as unknown as jest.Mock;

function lead(id: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: id,
    clientId: 'client1',
    fullName: 'Abdul Wadood',
    emailSubject: 'Personal subject',
    emailBody: '<p>Body</p>',
    email: 'abdul@gmail.com',
    discoveredEmails: ['abdul@gmail.com'],
    verifiedEmails: [{ email: 'abdul@gmail.com', status: 'valid' }],
    approved: false,
    currentCompanies: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

function mockLeads(leads: Array<Record<string, unknown>>) {
  mockFind.mockReturnValue({
    select: () => ({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve(leads) }) }),
    }),
  });
  mockCount.mockResolvedValue(leads.length);
}

function call(query: string) {
  return GET(new NextRequest(`https://app.test/api/lead-ingestion/drafts${query}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClientFind.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: 'client1', name: 'Abdul #7' }]) }) });
});

describe('GET /api/lead-ingestion/drafts', () => {
  it('returns one item per draft with the client name and counts', async () => {
    mockLeads([
      lead('l1', {
        currentCompanies: [
          { companyName: 'MantiqSoft', emailSubject: 'S', emailBody: '<p>B</p>', companyEmails: ['info@m.com'] },
        ],
      }),
    ]);

    const body = await (await call('?approval=all&smtp=all&sendStatus=all')).json();

    expect(body.success).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ companyIndex: -1, clientName: 'Abdul #7', serial: '#7' });
    expect(body.counts).toMatchObject({ total: 2, draft: 2 });
  });

  it('filters approved and draft boxes of the same lead apart', async () => {
    mockLeads([
      lead('l1', {
        approved: true,
        currentCompanies: [
          {
            companyName: 'MantiqSoft',
            emailSubject: 'S',
            emailBody: '<p>B</p>',
            companyEmails: ['info@m.com'],
            approved: false,
          },
        ],
      }),
    ]);

    const drafts = await (await call('?approval=draft')).json();
    expect(drafts.items).toHaveLength(1);
    expect(drafts.items[0].companyIndex).toBe(0);

    const approved = await (await call('?approval=approved')).json();
    expect(approved.items).toHaveLength(1);
    expect(approved.items[0].companyIndex).toBe(-1);
  });

  it('understands every SMTP filter value', async () => {
    mockLeads([
      lead('l1'),
      lead('l2', { verifiedEmails: [{ email: 'abdul@gmail.com', status: 'pending' }] }),
      lead('l3', { email: null, discoveredEmails: [] }),
    ]);

    expect((await (await call('?smtp=valid')).json()).items).toHaveLength(1);
    expect((await (await call('?smtp=unverified')).json()).items).toHaveLength(1);
    expect((await (await call('?smtp=no_contact_email')).json()).items).toHaveLength(1);
    expect((await (await call('?smtp=bogus')).json()).items).toHaveLength(3);
  });

  it('paginates per draft, not per lead', async () => {
    mockLeads([lead('l1'), lead('l2'), lead('l3')]);

    const first = await (await call('?limit=2&page=1')).json();
    expect(first.items).toHaveLength(2);
    expect(first).toMatchObject({ total: 3, hasMore: true, pages: 2 });

    const second = await (await call('?limit=2&page=2')).json();
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it('searches subjects and bodies too', async () => {
    mockLeads([lead('l1')]);
    await call('?search=verification+layer');

    const conditions = mockFind.mock.calls[0][0].$and as Array<Record<string, unknown>>;
    const search = conditions.find(
      (part) => '$or' in part && JSON.stringify(part).includes('fullName')
    ) as { $or: Array<Record<string, unknown>> };
    const fields = search.$or.flatMap(Object.keys);
    expect(fields).toEqual(expect.arrayContaining(['emailSubject', 'emailBody', 'currentCompanies.emailBody']));
  });

  it('reports when more leads matched than were scanned', async () => {
    mockLeads([lead('l1')]);
    mockCount.mockResolvedValue(5000);
    const body = await (await call('')).json();
    expect(body.truncated).toBe(true);
  });

  it('answers with an error payload when the database fails', async () => {
    mockFind.mockImplementation(() => {
      throw new Error('mongo down');
    });
    const response = await call('');
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('mongo down');
  });
});
