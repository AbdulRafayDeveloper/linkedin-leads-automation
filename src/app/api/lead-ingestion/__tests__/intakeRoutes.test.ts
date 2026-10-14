/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

const previewIngestion = jest.fn();
const createLeadFromPreview = jest.fn();
const runIngestionPipeline = jest.fn();
const after = jest.fn((work: () => unknown) => work());

jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return { ...actual, after: (work: () => unknown) => after(work) };
});

jest.mock('@/services/lead-ingestion/intake', () => {
  const actual = jest.requireActual('@/services/lead-ingestion/intake');
  return {
    ...actual,
    previewIngestion: (...args: unknown[]) => previewIngestion(...args),
    createLeadFromPreview: (...args: unknown[]) => createLeadFromPreview(...args),
  };
});

jest.mock('@/services/lead-ingestion/pipeline', () => ({
  runIngestionPipeline: (...args: unknown[]) => runIngestionPipeline(...args),
  isPipelineRunning: jest.requireActual('@/services/lead-ingestion/pipeline').isPipelineRunning,
}));

const PROFILE = 'Priya Nandakumar, VP Engineering at Solstice Robotics, Melbourne';

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  const { resetRateLimits } = await import('@/lib/api/rateLimit');
  resetRateLimits();
});

describe('POST /api/lead-ingestion/preview', () => {
  it('returns the preview from the service', async () => {
    previewIngestion.mockResolvedValue({ summary: { fullName: 'Priya' }, warnings: [], duplicate: null });
    const { POST } = await import('../preview/route');

    const response = await POST(post('http://localhost/api/lead-ingestion/preview', { content: PROFILE }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview.summary.fullName).toBe('Priya');
  });

  it('passes a validation message straight through', async () => {
    const { IngestionInputError } = jest.requireActual('@/services/lead-ingestion/intake');
    previewIngestion.mockRejectedValue(new IngestionInputError('That looks too short for a profile.'));
    const { POST } = await import('../preview/route');

    const response = await POST(post('http://localhost/api/lead-ingestion/preview', { content: 'x' }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toMatch(/too short/);
  });

  it('hides internal failures behind a friendly message', async () => {
    previewIngestion.mockRejectedValue(new Error('groq 500 ECONNRESET'));
    const { POST } = await import('../preview/route');

    const response = await POST(post('http://localhost/api/lead-ingestion/preview', { content: PROFILE }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).not.toMatch(/ECONNRESET/);
  });

  it('refuses an oversized body before reading it', async () => {
    const { POST } = await import('../preview/route');
    const response = await POST(
      post('http://localhost/api/lead-ingestion/preview', { content: PROFILE }, { 'content-length': String(10 * 1024 * 1024) })
    );
    expect(response.status).toBe(413);
    expect(previewIngestion).not.toHaveBeenCalled();
  });

  it('rate limits a flood of extractions', async () => {
    previewIngestion.mockResolvedValue({ summary: {}, warnings: [], duplicate: null });
    const { POST } = await import('../preview/route');

    const statuses: number[] = [];
    for (let i = 0; i < 17; i += 1) {
      const response = await POST(
        post('http://localhost/api/lead-ingestion/preview', { content: PROFILE }, { 'x-forwarded-for': '203.0.113.9' })
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((s) => s === 200)).toHaveLength(15);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});

describe('POST /api/lead-ingestion/confirm', () => {
  it('creates the lead and starts the pipeline in the background', async () => {
    createLeadFromPreview.mockResolvedValue({ leadId: 'lead-1', clientId: 'client-1', clientName: 'Priya #01', warnings: [] });
    const { POST } = await import('../confirm/route');

    const response = await POST(post('http://localhost/api/lead-ingestion/confirm', { content: PROFILE, extraction: null }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.result.leadId).toBe('lead-1');
    expect(after).toHaveBeenCalled();
    expect(runIngestionPipeline).toHaveBeenCalledWith('lead-1');
  });

  it('reports a duplicate with the existing lead attached', async () => {
    const { DuplicateLeadError } = jest.requireActual('@/services/lead-ingestion/intake');
    const duplicate = { leadId: 'old-1', clientName: 'Priya #01', fullName: 'Priya', createdAt: new Date().toISOString() };
    createLeadFromPreview.mockRejectedValue(new DuplicateLeadError(duplicate));
    const { POST } = await import('../confirm/route');

    const response = await POST(post('http://localhost/api/lead-ingestion/confirm', { content: PROFILE }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.duplicate).toEqual(duplicate);
    expect(runIngestionPipeline).not.toHaveBeenCalled();
  });

  it('passes the force flag through', async () => {
    createLeadFromPreview.mockResolvedValue({ leadId: 'lead-2', clientId: 'c', clientName: 'n', warnings: [] });
    const { POST } = await import('../confirm/route');

    await POST(post('http://localhost/api/lead-ingestion/confirm', { content: PROFILE, force: true }));

    expect(createLeadFromPreview).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });
});
