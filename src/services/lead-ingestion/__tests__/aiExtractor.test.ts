import { extractWithAi } from '../aiExtractor';

describe('aiExtractor', () => {
  it('extracts structured candidate & current company details from LLM JSON response', async () => {
    const mockModel = {
      invoke: jest.fn().mockResolvedValue({
        content: `\`\`\`json
{
  "personSummary": "Jane Doe is a Senior Full Stack Engineer at Acme Corp.",
  "fullName": "Jane Doe",
  "currentCompanies": [
    {
      "companyName": "Acme Corp",
      "jobTitle": "Lead AI Architect",
      "workPeriod": "Apr 2025 - Present",
      "websiteUrl": "https://acme.com",
      "roleSummary": "Lead AI Architect"
    }
  ],
  "rawUrls": ["https://acme.com"],
  "rawEmails": ["jane.doe@acme.com"],
  "rawPhones": ["+1 (555) 019-2834"]
}
\`\`\``,
      }),
    };

    const result = await extractWithAi('some raw text');

    expect(result.personSummary).toBe('Jane Doe is a Senior Full Stack Engineer at Acme Corp.');
    expect(result.fullName).toBe('Jane Doe');
    expect(result.currentCompanies[0].companyName).toBe('Acme Corp');
    expect(result.currentCompanies[0].jobTitle).toBe('Lead AI Architect');
    expect(result.currentCompanies[0].websiteUrl).toBe('https://acme.com');
    expect(result.rawEmails[0]).toBe('jane.doe@acme.com');
    expect(result.rawPhones[0]).toBe('+1 (555) 019-2834');
  });
});
