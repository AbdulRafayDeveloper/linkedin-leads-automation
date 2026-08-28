import { generatePersonalizedEmail, type EmailGeneratorModel } from '../generation';
import type { CompanyResearchResult, ParsedLead } from '@/lib/types/lead';

function baseLead(overrides: Partial<ParsedLead> = {}): ParsedLead {
  return {
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
    expect(result.body.toLowerCase().startsWith('gus')).toBe(true);
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
    expect(result.body.toLowerCase().startsWith('gus')).toBe(true);
  });

  it('only reports personalization signals actually present in the lead data', async () => {
    const lead = baseLead({ skills: ['SQL', 'Growth Marketing'] });
    const result = await generatePersonalizedEmail(lead, baseCompany());
    expect(result.personalizationSignalsUsed.some((s) => s.includes('SQL'))).toBe(true);
  });
});
