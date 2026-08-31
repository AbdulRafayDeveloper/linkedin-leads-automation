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

import {
  generateLeadEmail,
  buildOutreachPrompt,
  refineEmailWithAi,
  type EmailGeneratorModel,
} from '../emailGenerator';

describe('emailGenerator', () => {
  const senderMock = {
    name: 'Abdul Rafay',
    title: 'Senior Developer',
    positioning: ['highly skilled developer'],
    portfolioUrl: 'https://portfolio.com',
    linkedinUrl: 'https://linkedin.com',
    phone: '+92 306 0000000',
  };

  it('builds the outreach prompt correctly with custom user prompt style', () => {
    const promptWithoutStyle = buildOutreachPrompt(
      'Jane',
      'Jane is a developer.',
      'https://northwind.com',
      senderMock
    );
    expect(promptWithoutStyle).toContain('Jane');
    expect(promptWithoutStyle).toContain('https://northwind.com');
    expect(promptWithoutStyle).not.toContain('Special style/type instructions');

    const promptWithStyle = buildOutreachPrompt(
      'Jane',
      'Jane is a developer.',
      'https://northwind.com',
      senderMock,
      'Write it in a funny tone'
    );
    expect(promptWithStyle).toContain('Special style/type instructions');
    expect(promptWithStyle).toContain('Write it in a funny tone');
  });

  it('invokes the LLM and successfully updates subject/body fields', async () => {
    const mockModel: EmailGeneratorModel = {
      invoke: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          subject: 'Outreach to Jane Doe',
          body: 'Hello Jane, I noticed your MERN skills.',
        }),
      }),
    };

    const leadId = 'mock-id-123';
    const result = (await generateLeadEmail(leadId, undefined, [mockModel], senderMock)) as any;

    expect(result.emailSubject).toBe('Outreach to Jane Doe');
    expect(result.emailBody).toContain('Hello Jane, I noticed your MERN skills.');
    expect(result.emailBody).toContain('Portfolio: https://portfolio.com');
    expect(result.emailBody).toContain('Best regards,<br />Abdul Rafay');
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

    const leadId = 'mock-id-123';
    const result = (await refineEmailWithAi(leadId, 'make it direct', [mockModel], senderMock)) as any;

    expect(result.emailSubject).toBe('Refined Subject');
    expect(result.emailBody).toBe('<p>Refined Body</p>');
  });
});
