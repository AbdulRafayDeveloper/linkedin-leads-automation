import { extractWithRegex } from '../regexExtractor';

const TEST_SAMPLE = `
Jane Doe
Senior Full Stack Engineer at Acme Corporation
San Francisco, CA

About
Jane is an experienced engineer. Reach her at jane.doe@acme.com.

https://www.linkedin.com/in/janedoe
https://www.acme.com
`;

describe('regexExtractor', () => {
  it('extracts name correctly from top lines', () => {
    const result = extractWithRegex(TEST_SAMPLE);
    expect(result.fullName).toBe('Jane Doe');
  });

  it('extracts email address successfully', () => {
    const result = extractWithRegex(TEST_SAMPLE);
    expect(result.email).toBe('jane.doe@acme.com');
  });

  it('extracts website URL distinct from social media links', () => {
    const result = extractWithRegex(TEST_SAMPLE);
    expect(result.websiteUrl).toBe('https://www.acme.com');
  });

  it('returns nulls for empty text', () => {
    const result = extractWithRegex('');
    expect(result).toEqual({
      fullName: null,
      email: null,
      websiteUrl: null,
    });
  });

  it('phone extraction is handled by AI (not regex)', () => {
    // Phone numbers are now extracted by AI in aiExtractor.ts to support
    // all international formats. regexExtractor no longer returns phoneNumber.
    const result = extractWithRegex(TEST_SAMPLE);
    expect((result as unknown as Record<string, unknown>).phoneNumber).toBeUndefined();
  });
});
