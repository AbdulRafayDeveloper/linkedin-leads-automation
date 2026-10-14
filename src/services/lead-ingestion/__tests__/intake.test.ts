/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { AiExtractedData } from '../aiExtractor';

const extractWithAi = jest.fn<Promise<AiExtractedData>, [string]>();

jest.mock('../aiExtractor', () => {
  const actual = jest.requireActual('../aiExtractor');
  return { ...actual, extractWithAi: (text: string) => extractWithAi(text) };
});

const PROFILE = `Priya Nandakumar
VP Engineering at Solstice Robotics
Melbourne, Australia
priya@solstice-robotics.com
solstice-robotics.com
linkedin.com/in/priyanandakumar`;

function extraction(overrides: Partial<AiExtractedData> = {}): AiExtractedData {
  return {
    usedFallback: false,
    fullName: 'Priya Nandakumar',
    personSummary: 'VP Engineering at Solstice Robotics.',
    currentCompanies: [
      {
        companyName: 'Solstice Robotics',
        jobTitle: 'VP Engineering',
        workPeriod: 'Apr 2025 - Present',
        websiteUrl: 'https://solstice-robotics.com',
        roleSummary: 'Leads engineering.',
      },
    ],
    rawUrls: ['https://solstice-robotics.com', 'https://linkedin.com/in/priyanandakumar'],
    rawEmails: ['priya@solstice-robotics.com'],
    rawPhones: [],
    ...overrides,
  };
}

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

beforeEach(async () => {
  extractWithAi.mockReset();
  extractWithAi.mockResolvedValue(extraction());
  const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
  const { Client } = await import('@/lib/db/models/Client');
  await Promise.all([
    LeadIngestion.deleteMany({}),
    Client.deleteMany({}),
    mongoose.connection.db?.collection('clientcounters').deleteMany({}) ?? Promise.resolve(),
  ]);
});

describe('previewIngestion', () => {
  it('returns what was found and writes nothing', async () => {
    const { previewIngestion } = await import('../intake');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const { Client } = await import('@/lib/db/models/Client');

    const preview = await previewIngestion(PROFILE);

    expect(preview.summary.fullName).toBe('Priya Nandakumar');
    expect(preview.summary.companies[0]).toMatchObject({ companyName: 'Solstice Robotics' });
    expect(preview.summary.emails).toEqual(['priya@solstice-robotics.com']);
    expect(preview.warnings).toEqual([]);
    expect(preview.duplicate).toBeNull();
    expect(await LeadIngestion.countDocuments()).toBe(0);
    expect(await Client.countDocuments()).toBe(0);
  });

  it('rejects junk input before calling the model', async () => {
    const { previewIngestion, IngestionInputError } = await import('../intake');
    await expect(previewIngestion('x')).rejects.toBeInstanceOf(IngestionInputError);
    expect(extractWithAi).not.toHaveBeenCalled();
  });

  it('rejects text the model could not read anything from', async () => {
    extractWithAi.mockResolvedValue(
      extraction({
        fullName: null,
        rawEmails: [],
        currentCompanies: [
          { companyName: 'Unspecified Company', jobTitle: 'Professional', workPeriod: null, websiteUrl: null, roleSummary: '' },
        ],
      })
    );
    const { previewIngestion, IngestionInputError } = await import('../intake');
    await expect(previewIngestion(PROFILE)).rejects.toBeInstanceOf(IngestionInputError);
  });

  it('warns when the regex fallback was used and when no email was found', async () => {
    extractWithAi.mockResolvedValue(extraction({ usedFallback: true, rawEmails: [] }));
    const { previewIngestion } = await import('../intake');
    const preview = await previewIngestion(PROFILE);
    expect(preview.warnings.join(' ')).toMatch(/basic parser/);
    expect(preview.warnings.join(' ')).toMatch(/No email address/);
  });
});

describe('createLeadFromPreview', () => {
  it('saves the lead, the client and the pipeline starting point', async () => {
    const { createLeadFromPreview, hashRawText } = await import('../intake');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const { Client } = await import('@/lib/db/models/Client');

    const result = await createLeadFromPreview({ rawText: PROFILE, extraction: extraction() });

    const lead = await LeadIngestion.findById(result.leadId);
    expect(lead).not.toBeNull();
    expect(lead!.rawTextHash).toBe(hashRawText(PROFILE));
    expect(lead!.pipelineStage).toBe('extracted');
    expect(lead!.extractionSource).toBe('ai');
    expect(lead!.status).toBe('processing');

    const client = await Client.findById(result.clientId);
    expect(client!.name).toBe('Priya Nandakumar #01');
    expect(client!.linkedinUrl).toBe('https://linkedin.com/in/priyanandakumar');
  });

  it('marks a lead that came from the regex fallback', async () => {
    const { createLeadFromPreview } = await import('../intake');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const result = await createLeadFromPreview({
      rawText: PROFILE,
      extraction: extraction({ usedFallback: true }),
    });
    const lead = await LeadIngestion.findById(result.leadId);
    expect(lead!.extractionSource).toBe('regex_fallback');
    expect(result.warnings.join(' ')).toMatch(/basic parser/);
  });

  it('refuses the same profile twice, then allows it when forced', async () => {
    const { createLeadFromPreview, DuplicateLeadError } = await import('../intake');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');

    const first = await createLeadFromPreview({ rawText: PROFILE, extraction: extraction() });

    const second = createLeadFromPreview({ rawText: PROFILE, extraction: extraction() });
    await expect(second).rejects.toBeInstanceOf(DuplicateLeadError);
    await second.catch((error: InstanceType<typeof DuplicateLeadError>) => {
      expect(error.duplicate.leadId).toBe(first.leadId);
      expect(error.duplicate.clientName).toBe('Priya Nandakumar #01');
    });
    expect(await LeadIngestion.countDocuments()).toBe(1);

    await createLeadFromPreview({ rawText: PROFILE, extraction: extraction(), force: true });
    expect(await LeadIngestion.countDocuments()).toBe(2);
  });

  it('reports the duplicate in a later preview', async () => {
    const { createLeadFromPreview, previewIngestion } = await import('../intake');
    const created = await createLeadFromPreview({ rawText: PROFILE, extraction: extraction() });
    const preview = await previewIngestion(PROFILE);
    expect(preview.duplicate?.leadId).toBe(created.leadId);
  });

  it('drops details the browser sent that are not in the pasted text', async () => {
    const { createLeadFromPreview } = await import('../intake');
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');

    const result = await createLeadFromPreview({
      rawText: PROFILE,
      extraction: extraction({
        rawEmails: ['priya@solstice-robotics.com', 'ceo@victim.com'],
        rawUrls: ['https://solstice-robotics.com', 'https://victim.com'],
      }),
    });

    const lead = await LeadIngestion.findById(result.leadId);
    expect(lead!.discoveredEmails).toEqual(['priya@solstice-robotics.com']);
    expect(lead!.additionalUrls).not.toContain('https://victim.com');
  });

  it('numbers repeat names #01, #02 and never duplicates one under load', async () => {
    const { createLeadFromPreview } = await import('../intake');
    const { Client } = await import('@/lib/db/models/Client');

    await createLeadFromPreview({ rawText: `${PROFILE} one`, extraction: extraction() });
    await createLeadFromPreview({ rawText: `${PROFILE} two`, extraction: extraction() });

    await Promise.all(
      [3, 4, 5].map((n) =>
        createLeadFromPreview({ rawText: `${PROFILE} ${n}`, extraction: extraction() })
      )
    );

    const names = (await Client.find({ baseName: 'Priya Nandakumar' }).select('name').lean()).map((c) => c.name);
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    expect(names).toContain('Priya Nandakumar #01');
    expect(names).toContain('Priya Nandakumar #02');
  });

  it('removes the client again when the lead cannot be saved', async () => {
    const { LeadIngestion } = await import('@/lib/db/models/LeadIngestion');
    const { Client } = await import('@/lib/db/models/Client');
    const { createLeadFromPreview } = await import('../intake');

    const create = jest.spyOn(LeadIngestion, 'create').mockRejectedValueOnce(new Error('db down'));
    await expect(
      createLeadFromPreview({ rawText: PROFILE, extraction: extraction() })
    ).rejects.toThrow('db down');

    expect(await Client.countDocuments()).toBe(0);
    create.mockRestore();
  });

  it('names a client "Unknown Candidate" only when there is still a company or email', async () => {
    const { createLeadFromPreview } = await import('../intake');
    const { Client } = await import('@/lib/db/models/Client');
    await createLeadFromPreview({ rawText: PROFILE, extraction: extraction({ fullName: null }) });
    expect(await Client.findOne({ baseName: 'Unknown Candidate' })).not.toBeNull();
  });
});
