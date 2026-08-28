/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { processLeadContent } from '@/lib/processLead';
import { createLead } from '@/lib/db/operations/create';
import { enrichLead } from '@/lib/enrichment/enrichLead';

jest.mock('@/lib/processLead');
jest.mock('@/lib/db/operations/create');
jest.mock('@/lib/enrichment/enrichLead');
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: jest.fn((callback: () => unknown) => callback()),
}));

describe('POST /api/process', () => {
  beforeEach(() => jest.clearAllMocks());

  it('processes and saves a lead end-to-end', async () => {
    const fakeResult = {
      lead: { fullName: 'Gus Gollings' },
      company: {},
      emailDiscovery: { email: null, emailSource: 'NOT_FOUND', confidence: 'LOW', pagesSearched: [], notes: [] },
      validation: { status: 'NOT_FOUND', validationChecks: null, reasons: [], confidence: 'LOW' },
      generatedEmail: { subject: 'Hi', body: 'Gus, hello.', personalizationSignalsUsed: [], confidence: 'LOW', warnings: [] },
      totalProcessingTimeMs: 500,
    };
    (processLeadContent as jest.Mock).mockResolvedValue(fakeResult);
    (createLead as jest.Mock).mockResolvedValue({ _id: '1', fullName: 'Gus Gollings' });

    const request = new NextRequest('http://localhost/api/process', {
      method: 'POST',
      body: JSON.stringify({ content: 'Gus Gollings\nHead of Growth at Northwind Robotics' }),
    });
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.lead.fullName).toBe('Gus Gollings');
    expect(enrichLead).toHaveBeenCalledWith('1');
  });

  it('rejects a request with no content', async () => {
    const request = new NextRequest('http://localhost/api/process', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const response = await POST(request);
    expect(response.status).toBe(422);
  });

  it('returns a 500 error when processing throws', async () => {
    (processLeadContent as jest.Mock).mockRejectedValue(new Error('parse failure'));
    const request = new NextRequest('http://localhost/api/process', {
      method: 'POST',
      body: JSON.stringify({ content: 'some content' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(500);
  });
});
