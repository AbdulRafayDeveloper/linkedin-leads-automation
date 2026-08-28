import { extractLeadWithAi, type AiChatModel } from '../extractLeadWithAi';

function modelReturning(text: string): AiChatModel {
  return { invoke: async () => text };
}

function modelThrowing(message: string): AiChatModel {
  return {
    invoke: async () => {
      throw new Error(message);
    },
  };
}

const FULL_JSON_RESPONSE = JSON.stringify({
  fullName: 'Dinesh Singh MBA',
  linkedinProfileUrl: null,
  headline: 'Founder at Celux',
  currentTitle: 'Vision Strategist & Founder',
  currentCompany: 'Celux',
  currentCompanyLinkedInUrl: null,
  currentCompanyWebsite: 'https://celux.co/',
  location: 'Bella Vista, New South Wales, Australia',
  currentRoleStartDate: 'Sep 2024',
  about: 'I help businesses embrace momentum.',
  experience: ['Vision Strategist & Founder at Celux'],
  education: ['Western Sydney University'],
  skills: ['Pre-sales', 'Strategy'],
  recentActivity: ['Reshared a post about video search'],
  publicEmail: null,
});

describe('extractLeadWithAi', () => {
  it('throws on empty content without calling any model', async () => {
    await expect(extractLeadWithAi('', [modelReturning(FULL_JSON_RESPONSE)])).rejects.toThrow(
      'Cannot parse empty content'
    );
  });

  it('parses a well-formed JSON response into a ParsedLead', async () => {
    const result = await extractLeadWithAi('raw sales nav text', [modelReturning(FULL_JSON_RESPONSE)]);
    expect(result.fullName).toBe('Dinesh Singh MBA');
    expect(result.currentTitle).toBe('Vision Strategist & Founder');
    expect(result.currentCompany).toBe('Celux');
    expect(result.currentCompanyWebsite).toBe('https://celux.co/');
    expect(result.location).toBe('Bella Vista, New South Wales, Australia');
    expect(result.skills).toEqual(['Pre-sales', 'Strategy']);
    expect(result.sourceText).toBe('raw sales nav text');
  });

  it('extracts JSON even when the model wraps it in commentary or a code fence', async () => {
    const wrapped = `Here is the JSON you asked for:\n\`\`\`json\n${FULL_JSON_RESPONSE}\n\`\`\`\nLet me know if you need anything else.`;
    const result = await extractLeadWithAi('raw text', [modelReturning(wrapped)]);
    expect(result.fullName).toBe('Dinesh Singh MBA');
  });

  it('falls back to the second model when the first throws', async () => {
    const result = await extractLeadWithAi('raw text', [
      modelThrowing('Groq rate limited'),
      modelReturning(FULL_JSON_RESPONSE),
    ]);
    expect(result.fullName).toBe('Dinesh Singh MBA');
  });

  it('falls back to the second model when the first returns unparsable text', async () => {
    const result = await extractLeadWithAi('raw text', [
      modelReturning('sorry, I cannot help with that'),
      modelReturning(FULL_JSON_RESPONSE),
    ]);
    expect(result.fullName).toBe('Dinesh Singh MBA');
  });

  it('throws a combined error when every provider fails', async () => {
    await expect(
      extractLeadWithAi('raw text', [modelThrowing('groq down'), modelThrowing('openai down')])
    ).rejects.toThrow(/AI lead extraction failed on all providers/);
  });

  it('marks currentCompany as CURRENT_COMPANY_UNCERTAIN when the model returns null', async () => {
    const json = JSON.stringify({ fullName: 'Jane Doe', currentCompany: null });
    const result = await extractLeadWithAi('raw text', [modelReturning(json)]);
    expect(result.currentCompany).toBe('CURRENT_COMPANY_UNCERTAIN');
  });

  it('marks fullName as UNCERTAIN when the model omits it', async () => {
    const json = JSON.stringify({ currentCompany: 'Acme' });
    const result = await extractLeadWithAi('raw text', [modelReturning(json)]);
    expect(result.fullName).toBe('UNCERTAIN');
  });

  it('never fabricates a company website or email when the model returns null for them', async () => {
    const json = JSON.stringify({
      fullName: 'Jane Doe',
      currentCompany: 'Acme',
      currentCompanyWebsite: null,
      publicEmail: null,
    });
    const result = await extractLeadWithAi('raw text', [modelReturning(json)]);
    expect(result.currentCompanyWebsite).toBeNull();
    expect(result.publicEmail).toBeNull();
  });

  it('coerces non-array list fields to empty arrays instead of crashing', async () => {
    const json = JSON.stringify({ fullName: 'Jane Doe', skills: 'not an array' });
    const result = await extractLeadWithAi('raw text', [modelReturning(json)]);
    expect(result.skills).toEqual([]);
  });

  it('filters out non-string entries from list fields', async () => {
    const json = JSON.stringify({ fullName: 'Jane Doe', experience: ['Real role', 42, null, ''] });
    const result = await extractLeadWithAi('raw text', [modelReturning(json)]);
    expect(result.experience).toEqual(['Real role']);
  });
});
