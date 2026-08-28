/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { searchLeads } from '@/lib/db/operations/read';

jest.mock('@/lib/db/operations/read');

describe('GET /api/leads/search', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns matching leads for a query', async () => {
    (searchLeads as jest.Mock).mockResolvedValue([{ _id: '1', fullName: 'Gus Gollings' }]);
    const request = new NextRequest('http://localhost/api/leads/search?q=gus');
    const response = await GET(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.leads.length).toBe(1);
  });

  it('rejects a request with no query parameter', async () => {
    const request = new NextRequest('http://localhost/api/leads/search');
    const response = await GET(request);
    expect(response.status).toBe(422);
  });
});
