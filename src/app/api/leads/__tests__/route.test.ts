/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET, DELETE } from '../route';

jest.mock('@/lib/db/connection', () => ({
  connectToMongoDB: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/db/models/LeadIngestion', () => ({
  LeadIngestion: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    countDocuments: jest.fn().mockResolvedValue(0),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
  },
}));

jest.mock('@/lib/db/models/Client', () => ({
  Client: {
    find: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    }),
  },
}));

describe('GET /api/leads', () => {
  it('returns paginated leads', async () => {
    const request = new NextRequest('http://localhost/api/leads?page=1');
    const response = await GET(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(0);
  });
});

describe('DELETE /api/leads (bulk)', () => {
  it('bulk deletes leads by IDs', async () => {
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
