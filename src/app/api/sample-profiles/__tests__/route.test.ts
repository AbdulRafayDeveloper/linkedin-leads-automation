/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

const listSampleProfiles = jest.fn();
const createSampleProfile = jest.fn();
const updateSampleProfile = jest.fn();
const deleteSampleProfile = jest.fn();

jest.mock('@/services/sample-profiles/sampleProfiles', () => {
  const actual = jest.requireActual('@/services/sample-profiles/sampleProfiles');
  return {
    ...actual,
    listSampleProfiles: () => listSampleProfiles(),
    createSampleProfile: (input: unknown) => createSampleProfile(input),
    updateSampleProfile: (id: string, input: unknown) => updateSampleProfile(id, input),
    deleteSampleProfile: (id: string) => deleteSampleProfile(id),
  };
});

const SAMPLE = { id: 's1', title: 'Mark Allen', content: 'profile text', updatedAt: new Date().toISOString() };

function request(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.50' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  const { resetRateLimits } = await import('@/lib/api/rateLimit');
  resetRateLimits();
});

describe('GET /api/sample-profiles', () => {
  it('returns the saved samples', async () => {
    listSampleProfiles.mockResolvedValue([SAMPLE]);
    const { GET } = await import('../route');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.samples).toEqual([SAMPLE]);
  });

  it('hides an internal failure behind a readable message', async () => {
    listSampleProfiles.mockRejectedValue(new Error('ECONNRESET on cluster0'));
    const { GET } = await import('../route');

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).not.toMatch(/ECONNRESET/);
  });
});

describe('POST /api/sample-profiles', () => {
  it('saves a new sample', async () => {
    createSampleProfile.mockResolvedValue(SAMPLE);
    const { POST } = await import('../route');

    const response = await POST(request('http://localhost/api/sample-profiles', 'POST', { title: 'Mark Allen', content: 'profile text' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.sample).toEqual(SAMPLE);
    expect(createSampleProfile).toHaveBeenCalledWith({ title: 'Mark Allen', content: 'profile text' });
  });

  it('passes a validation message through unchanged', async () => {
    const { SampleProfileError } = jest.requireActual('@/services/sample-profiles/sampleProfiles');
    createSampleProfile.mockRejectedValue(new SampleProfileError('Give this sample a name.'));
    const { POST } = await import('../route');

    const response = await POST(request('http://localhost/api/sample-profiles', 'POST', { content: 'text' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('Give this sample a name.');
  });

  it('rate limits a flood of writes', async () => {
    createSampleProfile.mockResolvedValue(SAMPLE);
    const { POST } = await import('../route');

    const statuses: number[] = [];
    for (let i = 0; i < 32; i += 1) {
      const response = await POST(request('http://localhost/api/sample-profiles', 'POST', { title: 't', content: 'c' }));
      statuses.push(response.status);
    }

    expect(statuses.filter((s) => s === 201)).toHaveLength(30);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});

describe('PUT and DELETE /api/sample-profiles/[id]', () => {
  it('updates a sample', async () => {
    updateSampleProfile.mockResolvedValue({ ...SAMPLE, title: 'Renamed' });
    const { PUT } = await import('../[id]/route');

    const response = await PUT(request('http://localhost/api/sample-profiles/s1', 'PUT', { title: 'Renamed', content: 'c' }), {
      params: Promise.resolve({ id: 's1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sample.title).toBe('Renamed');
    expect(updateSampleProfile).toHaveBeenCalledWith('s1', { title: 'Renamed', content: 'c' });
  });

  it('reports a sample that is already gone', async () => {
    const { SampleProfileError } = jest.requireActual('@/services/sample-profiles/sampleProfiles');
    updateSampleProfile.mockRejectedValue(new SampleProfileError('That sample no longer exists.', 404));
    const { PUT } = await import('../[id]/route');

    const response = await PUT(request('http://localhost/api/sample-profiles/s1', 'PUT', { title: 'a', content: 'b' }), {
      params: Promise.resolve({ id: 's1' }),
    });

    expect(response.status).toBe(404);
  });

  it('deletes a sample', async () => {
    deleteSampleProfile.mockResolvedValue(undefined);
    const { DELETE } = await import('../[id]/route');

    const response = await DELETE(request('http://localhost/api/sample-profiles/s1', 'DELETE'), {
      params: Promise.resolve({ id: 's1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(deleteSampleProfile).toHaveBeenCalledWith('s1');
  });
});
