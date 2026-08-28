/**
 * @jest-environment node
 */
jest.mock('@/lib/research/research');
jest.mock('@/lib/research/crawler');
jest.mock('@/lib/email/validation', () => {
  const actual = jest.requireActual('@/lib/email/validation');
  return { ...actual, validateEmailEntries: jest.fn() };
});

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { researchCompany } from '@/lib/research/research';
import { crawlWebsite } from '@/lib/research/crawler';
import { validateEmailEntries } from '@/lib/email/validation';
import type { CompanyResearchResult, ProcessingResult } from '@/lib/types/lead';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { connectToMongoDB } = await import('@/lib/db/connection');
  await connectToMongoDB();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  const { Lead } = await import('@/lib/db/models/Lead');
  await Lead.deleteMany({});
  jest.clearAllMocks();
});

function baseCompanyResult(overrides: Partial<CompanyResearchResult> = {}): CompanyResearchResult {
  return {
    companyName: 'Northwind Robotics',
    officialWebsite: 'https://www.northwindrobotics.com',
    confidence: 'HIGH',
    description: null,
    signals: [],
    discoveredEmails: [],
    sourceUrls: [],
    ...overrides,
  };
}

function makeProcessingResult(overrides: Partial<ProcessingResult['lead']> = {}): ProcessingResult {
  return {
    lead: {
      fullName: 'Gus Gollings',
      linkedinProfileUrl: null,
      headline: null,
      currentTitle: 'Head of Growth',
      currentCompany: 'Northwind Robotics',
      currentCompanyLinkedInUrl: null,
      currentCompanyWebsite: null,
      location: null,
      currentRoleStartDate: null,
      about: null,
      experience: [],
      education: [],
      skills: [],
      recentActivity: [],
      publicEmail: null,
      sourceText: 'raw',
      ...overrides,
    },
    company: baseCompanyResult(),
    emailDiscovery: {
      email: null,
      emailSource: 'NOT_FOUND',
      confidence: 'LOW',
      pagesSearched: [],
      notes: [],
    },
    validation: {
      status: 'NOT_FOUND',
      validationChecks: null,
      reasons: [],
      confidence: 'LOW',
    },
    generatedEmail: {
      subject: 'Hi',
      body: 'Gus, hello.',
      personalizationSignalsUsed: [],
      confidence: 'LOW',
      warnings: [],
    },
    totalProcessingTimeMs: 100,
  };
}

describe('enrichLead', () => {
  it('still crawls the company and adds emails when the lead already has one', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(
      makeProcessingResult({}),
    );
    saved.email = 'gus@northwindrobotics.com';
    saved.emails.push({
      email: 'gus@northwindrobotics.com',
      source: 'LEAD_PROFILE',
      sourceUrl: null,
      emailType: 'PERSONAL',
      validationStatus: 'valid',
      validationDetails: null,
      discoveredAt: new Date(),
      validatedAt: new Date(),
    } as never);
    await saved.save();

    (researchCompany as jest.Mock).mockResolvedValue(baseCompanyResult());
    (crawlWebsite as jest.Mock).mockResolvedValue({
      crawledUrls: ['https://www.northwindrobotics.com/contact'],
      emails: [
        { email: 'hello@northwindrobotics.com', sourceUrl: 'https://www.northwindrobotics.com/contact', emailType: 'GENERAL' },
      ],
      failedUrls: [],
    });
    (validateEmailEntries as jest.Mock).mockResolvedValue([
      { email: 'hello@northwindrobotics.com', validationStatus: 'valid', validationDetails: '{}' },
    ]);

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated?.emails).toHaveLength(2);
    expect(updated?.emails.map((e) => e.email)).toEqual(
      expect.arrayContaining(['gus@northwindrobotics.com', 'hello@northwindrobotics.com'])
    );
    expect(updated?.enrichmentStatus).toBe('COMPLETED');
    expect(crawlWebsite).toHaveBeenCalled();
  });

  it('discovers an email via company crawl when the lead has none', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult());

    (researchCompany as jest.Mock).mockResolvedValue(baseCompanyResult());
    (crawlWebsite as jest.Mock).mockResolvedValue({
      crawledUrls: ['https://www.northwindrobotics.com/contact'],
      emails: [
        { email: 'contact@northwindrobotics.com', sourceUrl: 'https://www.northwindrobotics.com/contact', emailType: 'GENERAL' },
      ],
      failedUrls: [],
    });
    (validateEmailEntries as jest.Mock).mockResolvedValue([
      { email: 'contact@northwindrobotics.com', validationStatus: 'valid', validationDetails: '{}' },
    ]);

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated?.emails).toHaveLength(1);
    expect(updated?.email).toBe('contact@northwindrobotics.com');
    expect(updated?.validationStatus).toBe('PASS');
  });

  it('stores multiple distinct public emails discovered on the company site', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult());

    (researchCompany as jest.Mock).mockResolvedValue(baseCompanyResult());
    (crawlWebsite as jest.Mock).mockResolvedValue({
      crawledUrls: [],
      emails: [
        { email: 'sales@northwindrobotics.com', sourceUrl: 'https://x/sales', emailType: 'SALES' },
        { email: 'support@northwindrobotics.com', sourceUrl: 'https://x/support', emailType: 'SUPPORT' },
        { email: 'careers@northwindrobotics.com', sourceUrl: 'https://x/careers', emailType: 'HR' },
      ],
      failedUrls: [],
    });
    (validateEmailEntries as jest.Mock).mockResolvedValue([
      { email: 'sales@northwindrobotics.com', validationStatus: 'valid', validationDetails: '{}' },
      { email: 'support@northwindrobotics.com', validationStatus: 'valid', validationDetails: '{}' },
      { email: 'careers@northwindrobotics.com', validationStatus: 'risky', validationDetails: '{}' },
    ]);

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated?.emails).toHaveLength(3);
    expect(updated?.emails.map((e) => e.emailType).sort()).toEqual(['HR', 'SALES', 'SUPPORT']);
  });

  it('deduplicates a crawled email that matches the lead\'s existing email case-insensitively', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult());
    saved.emails.push({
      email: 'Gus@NorthwindRobotics.com',
      source: 'LEAD_PROFILE',
      sourceUrl: null,
      emailType: 'PERSONAL',
      validationStatus: 'valid',
      validationDetails: null,
      discoveredAt: new Date(),
      validatedAt: new Date(),
    } as never);
    await saved.save();

    (researchCompany as jest.Mock).mockResolvedValue(baseCompanyResult());
    (crawlWebsite as jest.Mock).mockResolvedValue({
      crawledUrls: [],
      emails: [{ email: 'gus@northwindrobotics.com', sourceUrl: 'https://x', emailType: 'UNKNOWN' }],
      failedUrls: [],
    });
    (validateEmailEntries as jest.Mock).mockResolvedValue([]);

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated?.emails).toHaveLength(1);
  });

  it('completes gracefully when no official website can be found', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult());
    (researchCompany as jest.Mock).mockResolvedValue(
      baseCompanyResult({ officialWebsite: null, confidence: 'LOW' })
    );

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated?.websiteStatus).toBe('not_found');
    expect(updated?.crawlStatus).toBe('skipped');
    expect(updated?.enrichmentStatus).toBe('COMPLETED');
    expect(crawlWebsite).not.toHaveBeenCalled();
  });

  it('completes gracefully (without losing the lead) when the crawl itself fails', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult());
    (researchCompany as jest.Mock).mockResolvedValue(baseCompanyResult());
    (crawlWebsite as jest.Mock).mockRejectedValue(new Error('network unreachable'));

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated).not.toBeNull();
    expect(updated?.crawlStatus).toBe('failed');
    expect(updated?.enrichmentError).toContain('network unreachable');
    expect(updated?.enrichmentStatus).toBe('COMPLETED');
  });

  it('skips enrichment cleanly when the current company is uncertain', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult({ currentCompany: 'CURRENT_COMPANY_UNCERTAIN' }));

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated?.enrichmentStatus).toBe('COMPLETED');
    expect(updated?.websiteStatus).toBe('not_found');
    expect(researchCompany).not.toHaveBeenCalled();
  });

  it('marks enrichmentStatus FAILED and preserves the lead if an unexpected error occurs', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { enrichLead } = await import('../enrichLead');
    const { Lead } = await import('@/lib/db/models/Lead');

    const saved = await createLead(makeProcessingResult());
    (researchCompany as jest.Mock).mockRejectedValue(new Error('DNS explosion'));

    await enrichLead(saved._id.toString());

    const updated = await Lead.findById(saved._id);
    expect(updated).not.toBeNull();
    expect(updated?.enrichmentStatus).toBe('FAILED');
    expect(updated?.enrichmentError).toContain('DNS explosion');
  });

  it('does nothing and does not throw when the lead no longer exists', async () => {
    const { enrichLead } = await import('../enrichLead');
    const fakeId = new mongoose.Types.ObjectId().toString();
    await expect(enrichLead(fakeId)).resolves.toBeUndefined();
  });
});
