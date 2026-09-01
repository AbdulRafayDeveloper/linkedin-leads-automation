import { extractWithAi, type AiChatModel } from '../aiExtractor';

describe('aiExtractor', () => {
  it('extracts structured candidate & current company details from LLM JSON response', async () => {
    const mockModel: AiChatModel = {
      invoke: jest.fn().mockResolvedValue({
        content: `\`\`\`json
{
  "personSummary": "Jane Doe is a Senior Full Stack Engineer at Acme Corp.",
  "fullName": "Jane Doe",
  "companyName": "Acme Corp",
  "jobTitle": "Lead AI Architect",
  "websiteUrl": "https://acme.com",
  "email": "jane.doe@acme.com",
  "phone": "+1 (555) 019-2834"
}
\`\`\``,
      }),
    };

    const result = await extractWithAi('some raw text', [mockModel]);

    expect(result.personSummary).toBe('Jane Doe is a Senior Full Stack Engineer at Acme Corp.');
    expect(result.fullName).toBe('Jane Doe');
    expect(result.companyName).toBe('Acme Corp');
    expect(result.jobTitle).toBe('Lead AI Architect');
    expect(result.websiteUrl).toBe('https://acme.com');
    expect(result.email).toBe('jane.doe@acme.com');
    expect(result.phoneNumber).toBe('+1 (555) 019-2834');
  });

  it('falls back to second model if first fails', async () => {
    const failingModel: AiChatModel = {
      invoke: jest.fn().mockRejectedValue(new Error('API failure')),
    };
    const backupModel: AiChatModel = {
      invoke: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          personSummary: 'Fallback summary.',
          fullName: 'Jane Fallback',
          companyName: 'Beta Corp',
          jobTitle: 'Developer',
          websiteUrl: null,
          email: null,
          phone: null,
        }),
      }),
    };

    const result = await extractWithAi('some raw text', [failingModel, backupModel]);

    expect(result.fullName).toBe('Jane Fallback');
    expect(result.companyName).toBe('Beta Corp');
    expect(result.personSummary).toBe('Fallback summary.');
  });
});
