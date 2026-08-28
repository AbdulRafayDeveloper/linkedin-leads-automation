import { findVerifiedCompanyWebsite, verifyCompanyWebsiteWithAi } from '../websiteVerification';
import { findCompanyWebsite } from '../research';
import type { AiChatModel } from '@/lib/ai/extractLeadWithAi';

jest.mock('../research', () => ({
  ...jest.requireActual('../research'),
  findCompanyWebsite: jest.fn(),
}));

function aiModel(response: string | { isMatch: boolean; reasoning?: string } | null): AiChatModel {
  return {
    invoke: async () => {
      if (response === null) throw new Error('provider unavailable');
      const content = typeof response === 'string' ? response : JSON.stringify(response);
      return { content };
    },
  };
}

describe('verifyCompanyWebsiteWithAi', () => {
  it('returns isMatch true when the model confirms a match', async () => {
    const result = await verifyCompanyWebsiteWithAi(
      'https://acme.com',
      'Acme Robotics builds autonomous robots in Austin, Texas.',
      'Acme Robotics',
      { location: 'Austin, Texas' },
      'Ava Founder',
      [aiModel({ isMatch: true, reasoning: 'Name and location both match' })]
    );
    expect(result.isMatch).toBe(true);
  });

  it('returns isMatch false when the model reports no match', async () => {
    const result = await verifyCompanyWebsiteWithAi(
      'https://acme.net',
      'Generic landing page with no relevant content.',
      'Acme Robotics',
      {},
      null,
      [aiModel({ isMatch: false, reasoning: 'Homepage does not mention the company' })]
    );
    expect(result.isMatch).toBe(false);
  });

  it('fails closed (not a match) when every model is unavailable or unparsable', async () => {
    const result = await verifyCompanyWebsiteWithAi(
      'https://acme.net',
      'some content',
      'Acme Robotics',
      {},
      null,
      [aiModel(null), aiModel('not json at all')]
    );
    expect(result.isMatch).toBe(false);
  });
});

describe('findVerifiedCompanyWebsite', () => {
  beforeEach(() => jest.clearAllMocks());

  it('accepts the existing website immediately when it verifies, without searching for a new one', async () => {
    const result = await findVerifiedCompanyWebsite(
      'Acme Robotics',
      {},
      'Ava Founder',
      'https://acme.com',
      {
        homepageFetcher: async () => 'Acme Robotics official homepage content describing the company.',
        verifyModels: [aiModel({ isMatch: true })],
      }
    );

    expect(result).toEqual({ website: 'https://acme.com', verified: true, attempts: 1 });
    expect(findCompanyWebsite).not.toHaveBeenCalled();
  });

  it('searches for a new candidate when the existing website fails verification, and accepts it if it verifies', async () => {
    (findCompanyWebsite as jest.Mock).mockResolvedValue({
      website: 'https://acme-robotics.co',
      confidence: 'MEDIUM',
      queriesTried: [],
    });

    const fetcher = jest.fn(async (url: string) =>
      url === 'https://acme.com' ? 'Unrelated company, nothing to do with robotics.' : 'Acme Robotics homepage, robotics company.'
    );
    // A model whose verdict genuinely depends on the homepage content it was
    // shown, so the test proves the wrong candidate is rejected and a fresh
    // one is tried, rather than any candidate always passing.
    const conditionalModel: AiChatModel = {
      invoke: async (prompt: string) => ({
        content: JSON.stringify({ isMatch: prompt.includes('robotics company') }),
      }),
    };

    const result = await findVerifiedCompanyWebsite('Acme Robotics', {}, 'Ava Founder', 'https://acme.com', {
      homepageFetcher: fetcher,
      verifyModels: [conditionalModel],
    });

    expect(fetcher).toHaveBeenCalledWith('https://acme.com');
    expect(fetcher).toHaveBeenCalledWith('https://acme-robotics.co');
    expect(result.website).toBe('https://acme-robotics.co');
    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('stops after maxAttempts and reports not found when nothing ever verifies', async () => {
    let call = 0;
    (findCompanyWebsite as jest.Mock).mockImplementation(async () => {
      call += 1;
      return { website: `https://candidate-${call}.com`, confidence: 'LOW', queriesTried: [] };
    });

    const result = await findVerifiedCompanyWebsite('Acme Robotics', {}, null, null, {
      maxAttempts: 3,
      homepageFetcher: async () => 'some page content',
      verifyModels: [aiModel({ isMatch: false })],
    });

    expect(result).toEqual({ website: null, verified: false, attempts: 3 });
    expect(findCompanyWebsite).toHaveBeenCalledTimes(3);
  });

  it('stops early once no further candidates can be found, without using all attempts', async () => {
    (findCompanyWebsite as jest.Mock).mockResolvedValue({ website: null, confidence: 'LOW', queriesTried: [] });

    const result = await findVerifiedCompanyWebsite('Acme Robotics', {}, null, null, {
      maxAttempts: 10,
      homepageFetcher: async () => 'content',
      verifyModels: [aiModel({ isMatch: false })],
    });

    expect(result).toEqual({ website: null, verified: false, attempts: 0 });
    expect(findCompanyWebsite).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable homepage as unverified and moves on to the next candidate', async () => {
    let call = 0;
    (findCompanyWebsite as jest.Mock).mockImplementation(async () => {
      call += 1;
      return { website: `https://candidate-${call}.com`, confidence: 'LOW', queriesTried: [] };
    });

    const result = await findVerifiedCompanyWebsite('Acme Robotics', {}, null, null, {
      maxAttempts: 5,
      homepageFetcher: async (url: string) => (url === 'https://candidate-2.com' ? 'Acme Robotics homepage' : null),
      verifyModels: [aiModel({ isMatch: true })],
    });

    expect(result.website).toBe('https://candidate-2.com');
    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('excludes already-tried candidates from the next search attempt', async () => {
    const excludeSets: Set<string>[] = [];
    (findCompanyWebsite as jest.Mock).mockImplementation(async (_name, _context, options) => {
      excludeSets.push(new Set(options.excludeOrigins));
      return { website: 'https://acme.com', confidence: 'LOW', queriesTried: [] };
    });

    await findVerifiedCompanyWebsite('Acme Robotics', {}, null, null, {
      maxAttempts: 2,
      homepageFetcher: async () => 'content',
      verifyModels: [aiModel({ isMatch: false })],
    });

    expect(excludeSets[0].size).toBe(0);
    expect(excludeSets[1].has('https://acme.com')).toBe(true);
  });
});
