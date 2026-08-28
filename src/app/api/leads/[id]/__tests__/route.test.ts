/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, PUT, DELETE } from '../route';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
import { deleteLead } from '@/lib/db/operations/delete';

jest.mock('@/lib/db/operations/read');
jest.mock('@/lib/db/operations/update');
jest.mock('@/lib/db/operations/delete');

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/leads/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the lead when found', async () => {
    (getLeadById as jest.Mock).mockResolvedValue({ _id: '1', fullName: 'Gus Gollings' });
    const response = await GET(new NextRequest('http://localhost/api/leads/1'), ctx('1'));
    expect(response.status).toBe(200);
  });

  it('returns 404 when the lead does not exist', async () => {
    (getLeadById as jest.Mock).mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/api/leads/1'), ctx('1'));
    expect(response.status).toBe(404);
  });
});

describe('PUT /api/leads/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates and returns the lead', async () => {
    (updateLead as jest.Mock).mockResolvedValue({ _id: '1', approvalStatus: 'APPROVED' });
    const request = new NextRequest('http://localhost/api/leads/1', {
      method: 'PUT',
      body: JSON.stringify({ approvalStatus: 'APPROVED' }),
    });
    const response = await PUT(request, ctx('1'));
    expect(response.status).toBe(200);
  });

  it('returns 404 when updating a non-existent lead', async () => {
    (updateLead as jest.Mock).mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/leads/1', {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    const response = await PUT(request, ctx('1'));
    expect(response.status).toBe(404);
  });
});

describe('DELETE /api/leads/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes and returns the lead', async () => {
    (deleteLead as jest.Mock).mockResolvedValue({ _id: '1' });
    const response = await DELETE(new NextRequest('http://localhost/api/leads/1'), ctx('1'));
    expect(response.status).toBe(200);
  });

  it('returns 404 when deleting a non-existent lead', async () => {
    (deleteLead as jest.Mock).mockResolvedValue(null);
    const response = await DELETE(new NextRequest('http://localhost/api/leads/1'), ctx('1'));
    expect(response.status).toBe(404);
  });
});
