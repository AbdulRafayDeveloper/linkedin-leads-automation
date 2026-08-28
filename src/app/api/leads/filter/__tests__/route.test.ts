/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { getFilteredLeads } from '@/lib/db/operations/read';

jest.mock('@/lib/db/operations/read');

describe('GET /api/leads/filter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns leads filtered by approval status', async () => {
    (getFilteredLeads as jest.Mock).mockResolvedValue({ leads: [], total: 0, page: 1, pages: 1 });
    const request = new NextRequest('http://localhost/api/leads/filter?approvalStatus=APPROVED');
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(getFilteredLeads).toHaveBeenCalledWith(
      expect.objectContaining({ approvalStatus: 'APPROVED' }),
      1,
      undefined
    );
  });

  it('returns a 500 error when the query fails', async () => {
    (getFilteredLeads as jest.Mock).mockRejectedValue(new Error('boom'));
    const request = new NextRequest('http://localhost/api/leads/filter');
    const response = await GET(request);
    expect(response.status).toBe(500);
  });
});
