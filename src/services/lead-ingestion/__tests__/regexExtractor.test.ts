import { extractWithRegex } from '../regexExtractor';

const TEST_SAMPLE = `
Jane Doe
Senior Full Stack Engineer at Acme Corporation
San Francisco, CA

About
Jane is an experienced engineer. Reach her at jane.doe@acme.com or call +1 (555) 019-2834.

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

  it('extracts phone number successfully', () => {
    const result = extractWithRegex(TEST_SAMPLE);
    expect(result.phoneNumber).toBe('+1 (555) 019-2834');
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
      phoneNumber: null,
      websiteUrl: null,
    });
  });
});
