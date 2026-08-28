/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { getLeadById } from '@/lib/db/operations/read';
import { updateLead } from '@/lib/db/operations/update';
import { findVerifiedCompanyWebsite } from '@/lib/research/websiteVerification';

jest.mock('@/lib/db/operations/read');
jest.mock('@/lib/db/operations/update');
jest.mock('@/lib/research/websiteVerification');

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req() {
  return new NextRequest('http://localhost/api/leads/1/find-website', { method: 'POST' });
}

describe('POST /api/leads/[id]/find-website', () => {
  beforeEach(() => jest.clearAllMocks());

  it('finds and persists an AI-verified company website using the lead as context', async () => {
    const lead = {
      _id: '1',
      fullName: 'Ava Founder',
      currentCompany: 'Acme Robotics',
      currentCompanyLocation: 'Austin, Texas',
      currentTitle: 'Founder',
      headline: 'Founder at Acme Robotics',
      about: null,
      currentCompanyWebsite: null,
    };
    (getLeadById as jest.Mock).mockResolvedValue(lead);
    (findVerifiedCompanyWebsite as jest.Mock).mockResolvedValue({
      website: 'https://acmerobotics.com',
      verified: true,
      attempts: 1,
    });
    (updateLead as jest.Mock).mockResolvedValue({
      ...lead,
      currentCompanyWebsite: 'https://acmerobotics.com',
      websiteVerified: true,
    });

    const response = await POST(req(), ctx('1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findVerifiedCompanyWebsite).toHaveBeenCalledWith(
      'Acme Robotics',
      {
        location: 'Austin, Texas',
        title: 'Founder',
        headline: 'Founder at Acme Robotics',
        about: null,
      },
      'Ava Founder',
      null
    );
    expect(updateLead).toHaveBeenCalledWith('1', {
      currentCompanyWebsite: 'https://acmerobotics.com',
      websiteStatus: 'found',
      websiteVerified: true,
    });
    expect(body.website).toBe('https://acmerobotics.com');
    expect(body.verified).toBe(true);
  });

  it('never fabricates a website: reports not found (and marks unverified) when nothing verifies after retries', async () => {
    const lead = {
      _id: '1',
      fullName: 'Ava Founder',
      currentCompany: 'Acme Robotics',
      currentCompanyLocation: null,
      currentTitle: null,
      headline: null,
      about: null,
      currentCompanyWebsite: null,
    };
    (getLeadById as jest.Mock).mockResolvedValue(lead);
    (findVerifiedCompanyWebsite as jest.Mock).mockResolvedValue({ website: null, verified: false, attempts: 10 });
    (updateLead as jest.Mock).mockResolvedValue({ ...lead, websiteStatus: 'not_found', websiteVerified: false });

    const response = await POST(req(), ctx('1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateLead).toHaveBeenCalledWith('1', { websiteStatus: 'not_found', websiteVerified: false });
    expect(body.website).toBeNull();
    expect(body.verified).toBe(false);
  });

  it('rejects when the lead has no known company to search for', async () => {
    (getLeadById as jest.Mock).mockResolvedValue({ _id: '1', currentCompany: 'CURRENT_COMPANY_UNCERTAIN' });
    const response = await POST(req(), ctx('1'));
    expect(response.status).toBe(400);
    expect(findVerifiedCompanyWebsite).not.toHaveBeenCalled();
  });

  it('returns 404 for a lead that does not exist', async () => {
    (getLeadById as jest.Mock).mockResolvedValue(null);
    const response = await POST(req(), ctx('1'));
    expect(response.status).toBe(404);
  });
});
