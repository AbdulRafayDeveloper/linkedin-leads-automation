/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mapUrlsToCompaniesWithAi = jest.fn();
const findEmailsOnWebsite = jest.fn();
const verifyEmailSmtp = jest.fn();
const generateLeadEmail = jest.fn();

jest.mock('../aiExtractor', () => {
  const actual = jest.requireActual('../aiExtractor');
  return { ...actual, mapUrlsToCompaniesWithAi: (...args: unknown[]) => mapUrlsToCompaniesWithAi(...args) };
});
jest.mock('../emailFinder', () => ({ findEmailsOnWebsite: (...args: unknown[]) => findEmailsOnWebsite(...args) }));
jest.mock('../smtpVerifier', () => ({ verifyEmailSmtp: (...args: unknown[]) => verifyEmailSmtp(...args) }));
jest.mock('../emailGenerator', () => ({ generateLeadEmail: (...args: unknown[]) => generateLeadEmail(...args) }));

let mongod: MongoMemoryServer;

async function makeLead(overrides: Record<string, unknown> = {}) {
  const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
  return LeadIngestion.create({
    clientId: new mongoose.Types.ObjectId(),
    rawText: 'Priya Nandakumar, VP Engineering at Solstice Robotics',
    fullName: 'Priya Nandakumar',
    companyName: 'Solstice Robotics',
    currentCompanies: [
      {
        companyName: 'Solstice Robotics',
        jobTitle: 'VP Engineering',
        websiteUrl: 'https://solstice-robotics.com',
        summary: '',
        companyEmails: [],
      },
    ],
    additionalUrls: ['https://solstice-robotics.com'],
    discoveredEmails: ['priya@solstice-robotics.com'],
    status: 'processing',
    crawlStatus: 'not_started',
    pipelineStage: 'extracted',
    ...overrides,
  });
}

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

beforeEach(async () => {
  jest.clearAllMocks();
  mapUrlsToCompaniesWithAi.mockResolvedValue({
    companies: [
      {
        companyName: 'Solstice Robotics',
        jobTitle: 'VP Engineering',
        workPeriod: null,
        websiteUrl: 'https://solstice-robotics.com',
        roleSummary: 'Leads engineering.',
      },
    ],
    portfolioUrl: null,
  });
  findEmailsOnWebsite.mockResolvedValue({ emails: ['hello@solstice-robotics.com'], phones: [], siteType: 'company_website' });
  verifyEmailSmtp.mockResolvedValue({ status: 'valid', reasons: [] });
  generateLeadEmail.mockResolvedValue({});
  const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
  await LeadIngestion.deleteMany({});
});

describe('isPipelineRunning', () => {
  it('is false when the lead is finished or never started', async () => {
    const { isPipelineRunning } = await import('../pipeline');
    expect(isPipelineRunning({ pipelineStage: 'done', pipelineStartedAt: new Date() })).toBe(false);
    expect(isPipelineRunning({ pipelineStage: 'crawling', pipelineStartedAt: null })).toBe(false);
  });

  it('is true while a fresh run owns the lead, false once it goes stale', async () => {
    const { isPipelineRunning, STALE_RUN_MS } = await import('../pipeline');
    expect(isPipelineRunning({ pipelineStage: 'crawling', pipelineStartedAt: new Date() })).toBe(true);
    expect(
      isPipelineRunning({
        pipelineStage: 'crawling',
        pipelineStartedAt: new Date(Date.now() - STALE_RUN_MS - 1000),
      })
    ).toBe(false);
  });
});

async function runIngestionPipelineFresh(id: string) {
  const { runIngestionPipeline } = await import('../pipeline');
  return runIngestionPipeline(id);
}

describe('runIngestionPipeline', () => {
  it('runs every stage and marks the lead done', async () => {
    const { runIngestionPipeline } = await import('../pipeline');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const lead = await makeLead();

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result).toEqual({ ran: true, stage: 'done' });
    expect(mapUrlsToCompaniesWithAi).toHaveBeenCalledTimes(1);
    expect(findEmailsOnWebsite).toHaveBeenCalledTimes(1);
    expect(verifyEmailSmtp).toHaveBeenCalled();
    expect(generateLeadEmail).toHaveBeenCalledWith(lead._id.toString(), { forceRegenerate: true });

    const saved = await LeadIngestion.findById(lead._id);
    expect(saved!.pipelineStage).toBe('done');
    expect(saved!.status).toBe('completed');
    expect(saved!.pipelineStartedAt).toBeNull();
    expect(saved!.crawlStatus).toBe('completed');
    expect(saved!.discoveredEmails).toContain('hello@solstice-robotics.com');
    expect(saved!.verifiedEmails.map((v) => v.status)).toContain('valid');
  });

  it('does not start a second run while one is alive', async () => {
    const { runIngestionPipeline } = await import('../pipeline');
    const lead = await makeLead({ pipelineStage: 'crawling', pipelineStartedAt: new Date() });

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result.ran).toBe(false);
    expect(findEmailsOnWebsite).not.toHaveBeenCalled();
  });

  it('takes over a run that died, and resumes from the stage it reached', async () => {
    const { runIngestionPipeline, STALE_RUN_MS } = await import('../pipeline');
    const lead = await makeLead({
      pipelineStage: 'verifying',
      pipelineStartedAt: new Date(Date.now() - STALE_RUN_MS - 1000),
    });

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result).toEqual({ ran: true, stage: 'done' });
    // Mapping and crawling were already done before the run died.
    expect(mapUrlsToCompaniesWithAi).not.toHaveBeenCalled();
    expect(findEmailsOnWebsite).not.toHaveBeenCalled();
    expect(generateLeadEmail).toHaveBeenCalled();
  });

  it('records the failure instead of leaving the lead stuck', async () => {
    verifyEmailSmtp.mockRejectedValue(new Error('smtp exploded'));
    generateLeadEmail.mockRejectedValue(new Error('groq is down'));
    const { runIngestionPipeline } = await import('../pipeline');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const lead = await makeLead();

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result.stage).toBe('failed');
    const saved = await LeadIngestion.findById(lead._id);
    expect(saved!.pipelineStage).toBe('failed');
    expect(saved!.pipelineError).toMatch(/groq is down/);
    expect(saved!.pipelineStartedAt).toBeNull();
  });

  it('keeps going when one website cannot be crawled', async () => {
    findEmailsOnWebsite.mockRejectedValue(new Error('site offline'));
    const { runIngestionPipeline } = await import('../pipeline');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const lead = await makeLead();

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result.stage).toBe('done');
    const saved = await LeadIngestion.findById(lead._id);
    expect(saved!.crawlStatus).toBe('completed');
  });

  it('skips crawling when there is no website to crawl', async () => {
    mapUrlsToCompaniesWithAi.mockResolvedValue({
      companies: [{ companyName: 'Solstice Robotics', jobTitle: 'VP', workPeriod: null, websiteUrl: null, roleSummary: '' }],
      portfolioUrl: null,
    });
    const { runIngestionPipeline } = await import('../pipeline');
    const lead = await makeLead({ currentCompanies: [{ companyName: 'Solstice Robotics', jobTitle: 'VP', websiteUrl: null, summary: '', companyEmails: [] }] });

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result.stage).toBe('done');
    expect(findEmailsOnWebsite).not.toHaveBeenCalled();
  });

  it('never crawls a private or local address from a pasted profile', async () => {
    mapUrlsToCompaniesWithAi.mockResolvedValue({
      companies: [
        { companyName: 'Evil Co', jobTitle: 'VP', workPeriod: null, websiteUrl: 'http://127.0.0.1:3210/api/leads', roleSummary: '' },
      ],
      portfolioUrl: 'http://169.254.169.254/latest/meta-data/',
    });
    const { runIngestionPipeline } = await import('../pipeline');
    const lead = await makeLead({
      currentCompanies: [
        { companyName: 'Evil Co', jobTitle: 'VP', websiteUrl: 'http://127.0.0.1:3210/api/leads', summary: '', companyEmails: [] },
      ],
    });

    const result = await runIngestionPipeline(lead._id.toString());

    expect(result.stage).toBe('done');
    expect(findEmailsOnWebsite).not.toHaveBeenCalled();
  });

  it('survives another writer touching the lead mid-run', async () => {
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const lead = await makeLead();

    // The lead page saving an edit while the crawl is running used to break the
    // run with a Mongoose version error.
    findEmailsOnWebsite.mockImplementation(async () => {
      await LeadIngestion.updateOne({ _id: lead._id }, { $set: { summary: 'edited elsewhere' }, $inc: { __v: 1 } });
      return { emails: ['hello@solstice-robotics.com'], phones: [], siteType: 'company_website' };
    });

    const result = await runIngestionPipelineFresh(lead._id.toString());

    expect(result).toEqual({ ran: true, stage: 'done' });
    const saved = await LeadIngestion.findById(lead._id);
    expect(saved!.pipelineStage).toBe('done');
    expect(saved!.pipelineError).toBeNull();
  });

  it('picks up a lead saved before the pipeline fields existed', async () => {
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const lead = await makeLead();
    // Strip the new fields, the way an older record looks.
    await LeadIngestion.collection.updateOne(
      { _id: lead._id },
      { $unset: { pipelineStage: '', pipelineStartedAt: '' }, $set: { status: 'processing' } }
    );

    const result = await runIngestionPipelineFresh(lead._id.toString());

    expect(result).toEqual({ ran: true, stage: 'done' });
    const saved = await LeadIngestion.findById(lead._id);
    expect(saved!.pipelineStage).toBe('done');
    expect(saved!.status).toBe('completed');
  });

  it('rejects an invalid lead id', async () => {
    const { runIngestionPipeline } = await import('../pipeline');
    expect(await runIngestionPipeline('not-an-id')).toMatchObject({ ran: false, stage: 'failed' });
  });
});
