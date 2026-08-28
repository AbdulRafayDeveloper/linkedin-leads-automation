import { generatePersonalizedEmail, type EmailGeneratorModel } from '../generation';
import { BANNED_OPENING_PHRASES } from '@/lib/ai/prompts/outreachEmailPrompt';
import type { SenderProfile } from '@/lib/config/senderProfile';
import type { CompanyResearchResult, ParsedLead } from '@/lib/types/lead';

const testSender: SenderProfile = {
  name: 'Test Sender',
  title: 'Senior Full Stack AI Developer',
  positioning: ['builds production web and AI applications'],
  portfolioUrl: 'https://example-portfolio.test',
  linkedinUrl: 'https://linkedin.com/in/test-sender',
  phone: '+1 555 0100',
};

function baseLead(overrides: Partial<ParsedLead> = {}): ParsedLead {
  return {
    fullName: 'Gus Gollings',
    linkedinProfileUrl: null,
    headline: null,
    currentTitle: 'Head of Growth',
    currentCompany: 'Northwind Robotics',
    currentCompanyLinkedInUrl: null,
    currentCompanyWebsite: null,
    currentCompanyLocation: null,
    location: null,
    currentRoleStartDate: null,
    about: null,
    experience: [],
    education: [],
    skills: [],
    recentActivity: [],
    publicEmail: null,
    sourceText: '',
    ...overrides,
  };
}

function baseCompany(overrides: Partial<CompanyResearchResult> = {}): CompanyResearchResult {
  return {
    companyName: 'Northwind Robotics',
    officialWebsite: null,
    confidence: 'LOW',
    description: null,
    signals: [],
    discoveredEmails: [],
    sourceUrls: [],
    ...overrides,
  };
}

describe('generatePersonalizedEmail', () => {
  it('produces a template-based email when no model is provided', async () => {
    const result = await generatePersonalizedEmail(baseLead(), baseCompany());
    expect(result.body.startsWith('Hi Gus,')).toBe(true);
    expect(result.subject.length).toBeLessThanOrEqual(350);
  });

  it('uses the AI model output when it returns valid JSON', async () => {
    const model: EmailGeneratorModel = {
      invoke: async () =>
        JSON.stringify({
          subject: 'A quick note about your growth work',
          body: 'Gus, I saw your work at Northwind Robotics and wanted to connect.',
          personalizationSignalsUsed: ['current company: Northwind Robotics'],
        }),
    };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model);
    expect(result.subject).toBe('A quick note about your growth work');
    expect(result.warnings).toEqual([]);
  });

  it('falls back gracefully when the model throws', async () => {
    const model: EmailGeneratorModel = {
      invoke: async () => {
        throw new Error('provider unavailable');
      },
    };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model);
    expect(result.warnings.some((w) => w.includes('AI generation failed'))).toBe(true);
  });

  it('falls back when the model returns non-JSON content', async () => {
    const model: EmailGeneratorModel = { invoke: async () => 'not json at all' };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('truncates subjects longer than 350 characters', async () => {
    const longSubject = 'a'.repeat(400);
    const model: EmailGeneratorModel = {
      invoke: async () =>
        JSON.stringify({ subject: longSubject, body: 'Gus, hello there.', personalizationSignalsUsed: [] }),
    };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model);
    expect(result.subject.length).toBe(350);
    expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true);
  });

  it('strips dashes and em-dashes from generated content', async () => {
    const model: EmailGeneratorModel = {
      invoke: async () =>
        JSON.stringify({
          subject: 'Growth ideas — for Northwind',
          body: 'Gus - I wanted to reach out about your work.',
          personalizationSignalsUsed: [],
        }),
    };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model);
    expect(result.subject).not.toMatch(/[—–-]/);
    expect(result.body).not.toMatch(/[—–]/);
  });

  it('ensures the body starts with the recipient first name', async () => {
    const model: EmailGeneratorModel = {
      invoke: async () =>
        JSON.stringify({
          subject: 'Hello',
          body: 'I wanted to reach out to you directly.',
          personalizationSignalsUsed: [],
        }),
    };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model);
    expect(result.body.toLowerCase()).toMatch(/^hi gus\b/);
  });

  it('only reports personalization signals actually present in the lead data', async () => {
    const lead = baseLead({ skills: ['SQL', 'Growth Marketing'] });
    const result = await generatePersonalizedEmail(lead, baseCompany());
    expect(result.personalizationSignalsUsed.some((s) => s.includes('SQL'))).toBe(true);
  });

  it('appends the sender signature (name and links) to the generated body, never written by the AI', async () => {
    const model: EmailGeneratorModel = {
      invoke: async () =>
        JSON.stringify({
          subject: 'Loved your work on growth automation',
          body: 'Gus, your recent post on outbound automation stood out to me.',
          personalizationSignalsUsed: [],
        }),
    };
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), model, testSender);
    expect(result.body).toContain('Test Sender');
    expect(result.body).toContain('https://example-portfolio.test');
    expect(result.body).toContain('https://linkedin.com/in/test-sender');
    expect(result.body).toContain('+1 555 0100');
  });

  it('appends the sender signature to the deterministic fallback email too', async () => {
    const result = await generatePersonalizedEmail(baseLead(), baseCompany(), undefined, testSender);
    expect(result.body).toContain('https://example-portfolio.test');
  });

  it('uses the real default sender profile when none is injected', async () => {
    const result = await generatePersonalizedEmail(baseLead(), baseCompany());
    expect(result.body).toContain('Abdul Rafay');
    expect(result.body).toContain('rafaytech.vercel.app');
  });

  it('builds a prompt that bans generic filler openings and asks for a specific personalized subject', async () => {
    let capturedPrompt = '';
    const model: EmailGeneratorModel = {
      invoke: async (prompt: string) => {
        capturedPrompt = prompt;
        return JSON.stringify({ subject: 'Loved your work', body: 'Gus, hello.', personalizationSignalsUsed: [] });
      },
    };
    await generatePersonalizedEmail(baseLead(), baseCompany(), model, testSender);

    for (const phrase of BANNED_OPENING_PHRASES) {
      expect(capturedPrompt).toContain(phrase);
    }
    expect(capturedPrompt).toContain('ONE specific, concrete detail');
    // Wording of the "no signature in the body" instruction is expected to
    // evolve as the prompt file is tuned; only assert the concept survives.
    expect(capturedPrompt.toLowerCase()).toMatch(/sign-?off/);
  });
});
