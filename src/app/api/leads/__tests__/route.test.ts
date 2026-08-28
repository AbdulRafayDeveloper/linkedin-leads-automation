/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from '../route';
import { getFilteredLeads } from '@/lib/db/operations/read';
import { deleteLeadsByIds } from '@/lib/db/operations/delete';
import { createLead } from '@/lib/db/operations/create';

jest.mock('@/lib/db/operations/read');
jest.mock('@/lib/db/operations/delete');
jest.mock('@/lib/db/operations/create');

describe('GET /api/leads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated leads', async () => {
    (getFilteredLeads as jest.Mock).mockResolvedValue({ leads: [], total: 0, page: 1, pages: 1 });
    const request = new NextRequest('http://localhost/api/leads?page=1');
    const response = await GET(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
  });

  it('returns a 500 error when the database throws', async () => {
    (getFilteredLeads as jest.Mock).mockRejectedValue(new Error('DB down'));
    const request = new NextRequest('http://localhost/api/leads');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});

describe('POST /api/leads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a lead from a valid processing result', async () => {
    (createLead as jest.Mock).mockResolvedValue({ _id: '1', fullName: 'Gus Gollings' });
    const request = new NextRequest('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({ lead: { fullName: 'Gus Gollings' } }),
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
  });

  it('rejects a request missing lead data', async () => {
    const request = new NextRequest('http://localhost/api/leads', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(422);
  });
});

describe('DELETE /api/leads (bulk)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('bulk deletes leads by IDs', async () => {
    (deleteLeadsByIds as jest.Mock).mockResolvedValue({ deletedCount: 2 });
    const request = new NextRequest('http://localhost/api/leads', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['1', '2'] }),
    });
    const response = await DELETE(request);
    const body = await response.json();
    expect(body.deletedCount).toBe(2);
  });

  it('rejects bulk delete with no IDs', async () => {
    const request = new NextRequest('http://localhost/api/leads', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [] }),
    });
    const response = await DELETE(request);
    expect(response.status).toBe(422);
  });
});
