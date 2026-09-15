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

const savedPrompts: Record<string, string> = {};

jest.mock('@/lib/db/models/PromptSetting', () => ({
  PromptSetting: {
    findOne: jest.fn(({ key }: { key: string }) =>
      Promise.resolve(key in savedPrompts ? { key, promptText: savedPrompts[key] } : null)
    ),
  },
}));

import {
  generateLeadEmail,
  buildOutreachPrompt,
  buildFormatCheckPrompt,
  keepsWording,
  refineEmailWithAi,
  type EmailGeneratorModel,
} from '../emailGenerator';

const WRITING_KEY = 'global_outreach_prompt';
const FORMAT_KEY = 'email_format_check_prompt';

function answers(...replies: Array<{ subject: string; body: string }>): jest.Mock {
  const invoke = jest.fn();
  for (const reply of replies) invoke.mockResolvedValueOnce({ content: JSON.stringify(reply) });
  return invoke;
}

beforeEach(() => {
  for (const key of Object.keys(savedPrompts)) delete savedPrompts[key];
  savedPrompts[WRITING_KEY] = 'I am Abdul Rafay. Sign off with my portfolio link.';
  savedPrompts[FORMAT_KEY] = 'Each paragraph in its own <p>.';
});

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

  it('writes with the writing prompt, then saves the version fixed by the format check', async () => {
    const draft = { subject: 'Outreach to Jane', body: '<p>Hi Jane,<br>I noticed your MERN skills.</p>' };
    const fixed = { subject: 'Outreach to Jane', body: '<p>Hi Jane,</p><p>I noticed your MERN skills.</p>' };
    const invoke = answers(draft, fixed);

    const result = (await generateLeadEmail('mock-id-123', { models: [{ invoke }], forceRegenerate: true })) as any;

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toContain('I am Abdul Rafay. Sign off with my portfolio link.');
    expect(invoke.mock.calls[1][0]).toContain('Each paragraph in its own <p>.');
    expect(invoke.mock.calls[1][0]).toContain(draft.body);
    expect(result.emailSubject).toBe('Outreach to Jane');
    expect(result.emailBody).toBe(fixed.body);
  });

  it('keeps the first draft when the format check rewrites the wording', async () => {
    const draft = {
      subject: 'Outreach to Jane',
      body: '<p>Hi Jane,</p><p>I noticed your MERN skills and your work on the Northwind AI platform.</p>',
    };
    const invoke = answers(draft, { subject: 'Hello', body: '<p>Hi Jane,</p><p>Totally different text.</p>' });

    const result = (await generateLeadEmail('mock-id-123', { models: [{ invoke }], forceRegenerate: true })) as any;

    expect(result.emailBody).toBe(draft.body);
  });

  it('skips the format check when its prompt is saved empty', async () => {
    savedPrompts[FORMAT_KEY] = '';
    const invoke = answers({ subject: 'Hi Jane', body: '<p>Hi Jane,</p><p>Short note.</p>' });

    await generateLeadEmail('mock-id-123', { models: [{ invoke }], forceRegenerate: true });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('uses the default format rules when the format prompt was never saved', async () => {
    delete savedPrompts[FORMAT_KEY];
    const draft = { subject: 'Hi Jane', body: '<p>Hi Jane,</p><p>Short note.</p>' };
    const invoke = answers(draft, draft);

    await generateLeadEmail('mock-id-123', { models: [{ invoke }], forceRegenerate: true });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][0]).toContain('Every paragraph is its own <p>');
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

describe('format check helpers', () => {
  it('puts the rules and the draft in the format check prompt and asks for JSON', () => {
    const prompt = buildFormatCheckPrompt({ subject: 'S', body: '<p>B</p>' }, '  My rules  ');
    expect(prompt).toContain('"""\nMy rules\n"""');
    expect(prompt).toContain('Subject: S');
    expect(prompt).toContain('<p>B</p>');
    expect(prompt).toContain('{"subject": "...", "body": "..."}');
  });

  it('accepts pure format changes and rejects rewrites, cuts and padding', () => {
    const draft = {
      subject: 'Your post on agents',
      body: '<p>Hi Priya,<br>Your thread on agents caught my eye.</p><p>SUBJECT: x</p>',
    };
    expect(
      keepsWording(draft, {
        subject: 'Your post on agents',
        body: '<p>Hi Priya,</p><p>Your thread on agents caught my eye.</p>',
      })
    ).toBe(true);
    expect(keepsWording(draft, { subject: 'Your post on agents', body: '<p>Hi Priya,</p>' })).toBe(false);
    expect(
      keepsWording(draft, {
        subject: draft.subject,
        body: `${draft.body}<p>${'extra words here '.repeat(10)}</p>`,
      })
    ).toBe(false);
  });
});
