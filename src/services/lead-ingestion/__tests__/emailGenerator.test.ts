jest.mock('mongoose', () => ({
  Types: {
    ObjectId: {
      isValid: () => true,
    },
  },
  models: {},
  model: jest.fn(),
  Schema: class {},
}));

jest.mock('@/lib/db/connection', () => ({
  connectToMongoDB: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/db/models/LeadIngestion', () => {
  const innerMockLead = {
    _id: 'mock-id-123',
    fullName: 'Jane Doe',
    summary: 'Jane is a Full Stack AI Developer at Northwind Inc.',
    websiteUrl: 'https://northwind.com',
    emailSubject: null as string | null,
    emailBody: null as string | null,
    markModified: jest.fn(),
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
  };

  return {
    LeadIngestion: {
      findById: jest.fn().mockResolvedValue(innerMockLead),
    },
  };
});

jest.mock('@/lib/db/models/PromptSetting', () => ({
  PromptSetting: {
    findOne: jest.fn().mockResolvedValue({
      promptText: 'I am Abdul Rafay. Sign off with my portfolio link.',
    }),
  },
}));

import {
  generateLeadEmail,
  buildOutreachPrompt,
  refineEmailWithAi,
  type EmailGeneratorModel,
} from '../emailGenerator';

describe('emailGenerator', () => {
  it('builds the outreach prompt from the global and per-request prompts only', () => {
    const promptWithoutStyle = buildOutreachPrompt('Jane', 'Jane is a developer.', 'https://northwind.com');
    expect(promptWithoutStyle).toContain('Jane');
    expect(promptWithoutStyle).toContain('https://northwind.com');
    expect(promptWithoutStyle).not.toContain('Mandatory Sender, Style & Pitch Instructions');

    const promptWithStyle = buildOutreachPrompt(
      'Jane',
      'Jane is a developer.',
      'https://northwind.com',
      'Write it in a funny tone',
      'I am Abdul Rafay.'
    );
    expect(promptWithStyle).toContain('Mandatory Sender, Style & Pitch Instructions');
    expect(promptWithStyle).toContain('I am Abdul Rafay.\nWrite it in a funny tone');
  });

  it('passes the saved global prompt to the LLM and stores the body without an appended signature', async () => {
    const invoke = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        subject: 'Outreach to Jane Doe',
        body: '<p>Hi Jane,</p><p>I noticed your MERN skills.</p>',
      }),
    });
    const mockModel: EmailGeneratorModel = { invoke };

    const result = (await generateLeadEmail('mock-id-123', { models: [mockModel] })) as any;

    expect(invoke.mock.calls[0][0]).toContain('I am Abdul Rafay. Sign off with my portfolio link.');
    expect(result.emailSubject).toBe('Outreach to Jane Doe');
    expect(result.emailBody).toBe('<p>Hi Jane,</p><p>I noticed your MERN skills.</p>');
  });

  it('refines draft email body and subject based on user prompts', async () => {
    const mockModel: EmailGeneratorModel = {
      invoke: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          subject: 'Refined Subject',
          body: '<p>Refined Body</p>',
        }),
      }),
    };

    const result = (await refineEmailWithAi('mock-id-123', 'make it direct', [mockModel])) as any;

    expect(result.emailSubject).toBe('Refined Subject');
    expect(result.emailBody).toBe('<p>Refined Body</p>');
  });
});
