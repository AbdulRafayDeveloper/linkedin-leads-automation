/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
import { enrichLead } from '@/lib/enrichment/enrichLead';

jest.mock('@/lib/db/operations/read');
jest.mock('@/lib/db/operations/update');
jest.mock('@/lib/enrichment/enrichLead');
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: jest.fn((callback: () => unknown) => callback()),
}));

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/leads/[id]/enrich', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resets enrichment status and re-triggers enrichment for an existing lead', async () => {
    (getLeadById as jest.Mock).mockResolvedValue({ _id: '1', fullName: 'Gus Gollings' });
    (updateLead as jest.Mock).mockResolvedValue({ _id: '1', enrichmentStatus: 'QUEUED' });

    const response = await POST(new NextRequest('http://localhost/api/leads/1/enrich', { method: 'POST' }), ctx('1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateLead).toHaveBeenCalledWith('1', { enrichmentStatus: 'QUEUED', enrichmentError: null });
    expect(enrichLead).toHaveBeenCalledWith('1');
    expect(body.lead.enrichmentStatus).toBe('QUEUED');
  });

  it('returns 404 for a lead that does not exist', async () => {
    (getLeadById as jest.Mock).mockResolvedValue(null);
    const response = await POST(new NextRequest('http://localhost/api/leads/1/enrich', { method: 'POST' }), ctx('1'));
    expect(response.status).toBe(404);
    expect(enrichLead).not.toHaveBeenCalled();
  });
});
