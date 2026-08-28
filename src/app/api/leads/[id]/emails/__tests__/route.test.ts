/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getLeadById } from '@/lib/db/operations/read';
import { validateEmailForEntry } from '@/lib/email/validation';

jest.mock('@/lib/db/operations/read');
jest.mock('@/lib/email/validation');

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    _id: '1',
    emails: [] as Array<{ email: string }>,
    emailDiscoveryStatus: 'not_started',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function request(email: unknown) {
  return new NextRequest('http://localhost/api/leads/1/emails', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

describe('POST /api/leads/[id]/emails', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds a manually entered email, validates it, and marks emails as found', async () => {
    const lead = makeLead();
    (getLeadById as jest.Mock).mockResolvedValue(lead);
    (validateEmailForEntry as jest.Mock).mockResolvedValue({
      email: 'contact@example.com',
      validationStatus: 'valid',
      validationDetails: '{}',
    });

    const response = await POST(request('Contact@Example.com'), ctx('1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(lead.emails).toHaveLength(1);
    expect(lead.emails[0]).toMatchObject({
      email: 'contact@example.com',
      source: 'MANUAL',
      validationStatus: 'valid',
    });
    expect(lead.emailDiscoveryStatus).toBe('emails_found');
    expect(lead.save).toHaveBeenCalled();
    expect(body.lead).toBeTruthy();
  });

  it('rejects a malformed email address without touching the database', async () => {
    const response = await POST(request('not-an-email'), ctx('1'));
    expect(response.status).toBe(400);
    expect(getLeadById).not.toHaveBeenCalled();
  });

  it('rejects an email that has already been added, case-insensitively', async () => {
    const lead = makeLead({ emails: [{ email: 'contact@example.com' }] });
    (getLeadById as jest.Mock).mockResolvedValue(lead);

    const response = await POST(request('CONTACT@example.com'), ctx('1'));

    expect(response.status).toBe(409);
    expect(validateEmailForEntry).not.toHaveBeenCalled();
    expect(lead.save).not.toHaveBeenCalled();
  });

  it('returns 404 for a lead that does not exist', async () => {
    (getLeadById as jest.Mock).mockResolvedValue(null);
    const response = await POST(request('contact@example.com'), ctx('1'));
    expect(response.status).toBe(404);
  });
});
