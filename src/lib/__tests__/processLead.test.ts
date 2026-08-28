/**
 * @jest-environment node
 */
jest.mock('@/lib/parser/parser');
jest.mock('@/lib/ai/extractLeadWithAi');
jest.mock('@/lib/research/research');
jest.mock('@/lib/email/discovery');
jest.mock('@/lib/email/validation');
jest.mock('@/lib/email/generation');
jest.mock('@/lib/ai/provider');

import { parseLeadContent } from '@/lib/parser/parser';
import { extractLeadWithAi } from '@/lib/ai/extractLeadWithAi';
import { researchCompany } from '@/lib/research/research';
import { discoverEmail } from '@/lib/email/discovery';
import { validateEmail } from '@/lib/email/validation';
import { generatePersonalizedEmail } from '@/lib/email/generation';
import { getChatModel } from '@/lib/ai/provider';
import { processLeadContent } from '../processLead';

const fakeLead = {
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
  sourceText: 'raw',
};

const fakeCompany = {
  companyName: 'Northwind Robotics',
  officialWebsite: null,
  confidence: 'LOW' as const,
  description: null,
  signals: [],
  discoveredEmails: [],
  sourceUrls: [],
};

describe('processLeadContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (extractLeadWithAi as jest.Mock).mockResolvedValue(fakeLead);
    (parseLeadContent as jest.Mock).mockReturnValue(fakeLead);
    (researchCompany as jest.Mock).mockResolvedValue(fakeCompany);
    (discoverEmail as jest.Mock).mockReturnValue({
      email: null,
      emailSource: 'NOT_FOUND',
      confidence: 'LOW',
      pagesSearched: [],
      notes: [],
    });
    (validateEmail as jest.Mock).mockResolvedValue({
      status: 'NOT_FOUND',
      validationChecks: null,
      reasons: [],
      confidence: 'LOW',
    });
    (generatePersonalizedEmail as jest.Mock).mockResolvedValue({
      subject: 'Hi Gus',
      body: 'Gus, hello.',
      personalizationSignalsUsed: [],
      confidence: 'LOW',
      warnings: [],
    });
  });

  it('extracts the lead via AI rather than the regex parser', async () => {
    (getChatModel as jest.Mock).mockResolvedValue({ invoke: jest.fn() });
    const result = await processLeadContent('raw content');

    expect(extractLeadWithAi).toHaveBeenCalledWith('raw content');
    expect(parseLeadContent).not.toHaveBeenCalled();
    expect(researchCompany).toHaveBeenCalledWith('Northwind Robotics', null, undefined, {
      location: undefined,
      title: 'Head of Growth',
      headline: null,
      about: null,
    });
    expect(result.lead).toEqual(fakeLead);
    expect(result.generatedEmail.subject).toBe('Hi Gus');
    expect(typeof result.totalProcessingTimeMs).toBe('number');
  });

  it('falls back to the regex parser only when AI extraction fails on every provider', async () => {
    (getChatModel as jest.Mock).mockResolvedValue({ invoke: jest.fn() });
    (extractLeadWithAi as jest.Mock).mockRejectedValue(new Error('all providers failed'));

    const result = await processLeadContent('raw content');

    expect(extractLeadWithAi).toHaveBeenCalledWith('raw content');
    expect(parseLeadContent).toHaveBeenCalledWith('raw content');
    expect(result.lead).toEqual(fakeLead);
  });

  it('falls back to template generation when the AI provider is unavailable', async () => {
    (getChatModel as jest.Mock).mockRejectedValue(new Error('no API key'));
    const result = await processLeadContent('raw content');

    expect(generatePersonalizedEmail).toHaveBeenLastCalledWith(fakeLead, fakeCompany);
    expect(result.generatedEmail.subject).toBe('Hi Gus');
  });
});
