import { extractWithAi, type AiChatModel } from '../aiExtractor';

describe('aiExtractor', () => {
  it('extracts structured details from LLM JSON response', async () => {
    const mockModel: AiChatModel = {
      invoke: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          summary: 'Jane Doe is a Senior Full Stack Engineer at Acme Corporation.',
          fullName: 'Jane Doe',
          email: 'jane.doe@acme.com',
          phone: '+1 (555) 019-2834',
          website: 'https://www.acme.com',
        }),
      }),
    };

    const result = await extractWithAi('some raw text', [mockModel]);

    expect(result.summary).toBe('Jane Doe is a Senior Full Stack Engineer at Acme Corporation.');
    expect(result.fullName).toBe('Jane Doe');
    expect(result.email).toBe('jane.doe@acme.com');
    expect(result.phoneNumber).toBe('+1 (555) 019-2834');
    expect(result.websiteUrl).toBe('https://www.acme.com');
  });

  it('falls back to second model if first fails', async () => {
    const failingModel: AiChatModel = {
      invoke: jest.fn().mockRejectedValue(new Error('API failure')),
    };
    const backupModel: AiChatModel = {
      invoke: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          summary: 'Fallback summary.',
          fullName: 'Jane Fallback',
          email: null,
          phone: null,
          website: null,
        }),
      }),
    };

    const result = await extractWithAi('some raw text', [failingModel, backupModel]);

    expect(result.fullName).toBe('Jane Fallback');
    expect(result.summary).toBe('Fallback summary.');
  });
});
