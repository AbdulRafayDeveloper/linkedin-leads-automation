/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { ProcessingResult } from '@/lib/types/lead';

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
});

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
      sourceText: 'raw text',
      ...overrides,
    },
    company: {
      companyName: 'Northwind Robotics',
      officialWebsite: null,
      confidence: 'LOW',
      description: null,
      signals: [],
      discoveredEmails: [],
      sourceUrls: [],
    },
    emailDiscovery: {
      email: 'gus@northwindrobotics.com',
      emailSource: 'LINKEDIN',
      confidence: 'HIGH',
      pagesSearched: [],
      notes: [],
    },
    validation: {
      status: 'PASS',
      validationChecks: {
        syntax: true,
        domainResolves: true,
        mxRecordsFound: true,
        isDisposable: false,
        isRoleEmail: false,
      },
      reasons: [],
      confidence: 'HIGH',
    },
    generatedEmail: {
      subject: 'Quick question',
      body: 'Gus, hello there.',
      personalizationSignalsUsed: [],
      confidence: 'MEDIUM',
      warnings: [],
    },
    totalProcessingTimeMs: 1200,
  };
}

describe('Lead MongoDB CRUD operations', () => {
  it('creates a new lead with all fields and default statuses', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const saved = await createLead(makeProcessingResult());
    expect(saved._id).toBeDefined();
    expect(saved.approvalStatus).toBe('PENDING');
    expect(saved.sentStatus).toBe('NOT_SENT');
    expect(saved.email).toBe('gus@northwindrobotics.com');
  });

  it('reads a lead by ID', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeadById } = await import('@/lib/db/operations/read');
    const saved = await createLead(makeProcessingResult());
    const found = await getLeadById(saved._id.toString());
    expect(found?.fullName).toBe('Gus Gollings');
  });

  it('reads all leads with pagination', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeads } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult({ fullName: 'Lead One' }));
    await createLead(makeProcessingResult({ fullName: 'Lead Two' }));
    const result = await getLeads(1, 1);
    expect(result.total).toBe(2);
    expect(result.leads.length).toBe(1);
    expect(result.pages).toBe(2);
  });

  it('filters leads by approval status', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeadsByApprovalStatus } = await import('@/lib/db/operations/read');
    const { updateApprovalStatus } = await import('@/lib/db/operations/update');
    const a = await createLead(makeProcessingResult({ fullName: 'A' }));
    await createLead(makeProcessingResult({ fullName: 'B' }));
    await updateApprovalStatus(a._id.toString(), 'APPROVED');
    const result = await getLeadsByApprovalStatus('APPROVED');
    expect(result.leads.length).toBe(1);
    expect(result.leads[0].fullName).toBe('A');
  });

  it('filters leads by validation status', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeadsByValidationStatus } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult());
    const result = await getLeadsByValidationStatus('PASS');
    expect(result.length).toBe(1);
  });

  it('searches leads by email', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { searchLeads } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult());
    const results = await searchLeads('gus@northwindrobotics.com');
    expect(results.length).toBe(1);
  });

  it('searches leads by name', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { searchLeads } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult({ fullName: 'Unique Name Here' }));
    const results = await searchLeads('unique name');
    expect(results.length).toBe(1);
  });

  it('updates the email field on a lead', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { updateLeadEmail } = await import('@/lib/db/operations/update');
    const saved = await createLead(makeProcessingResult());
    const updated = await updateLeadEmail(
      saved._id.toString(),
      'new@northwindrobotics.com',
      'New subject',
      'New body'
    );
    expect(updated?.email).toBe('new@northwindrobotics.com');
    expect(updated?.emailSubject).toBe('New subject');
  });

  it('updates approval status', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { updateApprovalStatus } = await import('@/lib/db/operations/update');
    const saved = await createLead(makeProcessingResult());
    const updated = await updateApprovalStatus(saved._id.toString(), 'REJECTED');
    expect(updated?.approvalStatus).toBe('REJECTED');
  });

  it('sorts leads by createdAt descending by default', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeads } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult({ fullName: 'First' }));
    await createLead(makeProcessingResult({ fullName: 'Second' }));
    const result = await getLeads(1, 10);
    expect(result.leads[0].fullName).toBe('Second');
  });

  it('paginates results correctly across pages', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeads } = await import('@/lib/db/operations/read');
    for (let i = 0; i < 5; i++) {
      await createLead(makeProcessingResult({ fullName: `Lead ${i}` }));
    }
    const page1 = await getLeads(1, 2);
    const page2 = await getLeads(2, 2);
    expect(page1.leads.length).toBe(2);
    expect(page2.leads.length).toBe(2);
    expect(page1.leads[0]._id).not.toEqual(page2.leads[0]._id);
  });

  it('deletes a single lead by ID', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { deleteLead } = await import('@/lib/db/operations/delete');
    const { getLeadById } = await import('@/lib/db/operations/read');
    const saved = await createLead(makeProcessingResult());
    await deleteLead(saved._id.toString());
    const found = await getLeadById(saved._id.toString());
    expect(found).toBeNull();
  });

  it('bulk deletes leads by IDs', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { deleteLeadsByIds } = await import('@/lib/db/operations/delete');
    const { getLeads } = await import('@/lib/db/operations/read');
    const a = await createLead(makeProcessingResult({ fullName: 'A' }));
    const b = await createLead(makeProcessingResult({ fullName: 'B' }));
    const result = await deleteLeadsByIds([a._id.toString(), b._id.toString()]);
    expect(result.deletedCount).toBe(2);
    const remaining = await getLeads(1, 10);
    expect(remaining.total).toBe(0);
  });

  it('returns an empty result set when no leads match a filter', async () => {
    const { getLeadsByApprovalStatus } = await import('@/lib/db/operations/read');
    const result = await getLeadsByApprovalStatus('APPROVED');
    expect(result.leads.length).toBe(0);
    expect(result.total).toBe(0);
  });

  it('returns null when updating a lead that does not exist', async () => {
    const { updateApprovalStatus } = await import('@/lib/db/operations/update');
    const fakeId = new mongoose.Types.ObjectId().toString();
    const updated = await updateApprovalStatus(fakeId, 'APPROVED');
    expect(updated).toBeNull();
  });

  it('filters leads by sent status', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeadsBySentStatus } = await import('@/lib/db/operations/read');
    const { updateSentStatus } = await import('@/lib/db/operations/update');
    const saved = await createLead(makeProcessingResult());
    await updateSentStatus(saved._id.toString(), 'SENT');
    const results = await getLeadsBySentStatus('SENT');
    expect(results.length).toBe(1);
    expect(results[0].sentAt).not.toBeNull();
  });

  it('filters leads by date range', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getLeadsByDateRange } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult());
    const results = await getLeadsByDateRange(
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000)
    );
    expect(results.length).toBe(1);
  });

  it('combines multiple filters via getFilteredLeads', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { getFilteredLeads } = await import('@/lib/db/operations/read');
    const { updateApprovalStatus } = await import('@/lib/db/operations/update');
    const a = await createLead(makeProcessingResult({ fullName: 'Combo Match' }));
    await createLead(makeProcessingResult({ fullName: 'Other Lead' }));
    await updateApprovalStatus(a._id.toString(), 'APPROVED');

    const result = await getFilteredLeads({ approvalStatus: 'APPROVED', search: 'combo' });
    expect(result.leads.length).toBe(1);
    expect(result.leads[0].fullName).toBe('Combo Match');
  });

  it('deletes all leads matching an approval status', async () => {
    const { createLead } = await import('@/lib/db/operations/create');
    const { deleteLeadsByApprovalStatus } = await import('@/lib/db/operations/delete');
    const { getLeads } = await import('@/lib/db/operations/read');
    await createLead(makeProcessingResult({ fullName: 'A' }));
    await createLead(makeProcessingResult({ fullName: 'B' }));
    const result = await deleteLeadsByApprovalStatus('PENDING');
    expect(result.deletedCount).toBe(2);
    const remaining = await getLeads(1, 10);
    expect(remaining.total).toBe(0);
  });
});
