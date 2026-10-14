/**
 * The guard against prompt injection: whatever the model returns, only details
 * that are really in the pasted text survive.
 *
 * @jest-environment node
 */
import { sanitizeExtraction, type AiExtractedData } from '../aiExtractor';

const SOURCE = `Priya Nandakumar
VP Engineering at Solstice Robotics
Melbourne, Australia
priya@solstice-robotics.com
solstice-robotics.com
+61 400 123 456`;

function extraction(overrides: Partial<AiExtractedData> = {}): AiExtractedData {
  return {
    usedFallback: false,
    fullName: 'Priya Nandakumar',
    personSummary: 'VP Engineering at Solstice Robotics.',
    currentCompanies: [
      {
        companyName: 'Solstice Robotics',
        jobTitle: 'VP Engineering',
        workPeriod: 'Apr 2025 - Present',
        websiteUrl: 'https://solstice-robotics.com',
        roleSummary: 'Leads the engineering team.',
      },
    ],
    rawUrls: ['https://solstice-robotics.com'],
    rawEmails: ['priya@solstice-robotics.com'],
    rawPhones: ['+61 400 123 456'],
    ...overrides,
  };
}

describe('sanitizeExtraction', () => {
  it('keeps details that appear in the pasted text', () => {
    const clean = sanitizeExtraction(extraction(), SOURCE);
    expect(clean.fullName).toBe('Priya Nandakumar');
    expect(clean.rawEmails).toEqual(['priya@solstice-robotics.com']);
    expect(clean.rawUrls).toEqual(['https://solstice-robotics.com']);
    expect(clean.rawPhones).toEqual(['+61 400 123 456']);
    expect(clean.currentCompanies[0].websiteUrl).toBe('https://solstice-robotics.com');
  });

  it('drops an email the model invented (prompt injection)', () => {
    const clean = sanitizeExtraction(
      extraction({ rawEmails: ['priya@solstice-robotics.com', 'ceo@victim.com'] }),
      SOURCE
    );
    expect(clean.rawEmails).toEqual(['priya@solstice-robotics.com']);
  });

  it('drops an invented URL, so the crawler never fetches it', () => {
    const clean = sanitizeExtraction(
      extraction({ rawUrls: ['https://solstice-robotics.com', 'https://victim.com'] }),
      SOURCE
    );
    expect(clean.rawUrls).toEqual(['https://solstice-robotics.com']);
  });

  it('clears a company website that is not in the text', () => {
    const clean = sanitizeExtraction(
      extraction({
        currentCompanies: [{ ...extraction().currentCompanies[0], websiteUrl: 'https://attacker.test' }],
      }),
      SOURCE
    );
    expect(clean.currentCompanies[0].websiteUrl).toBeNull();
  });

  it('drops a phone number that is not in the text', () => {
    const clean = sanitizeExtraction(extraction({ rawPhones: ['+1 202 555 0100'] }), SOURCE);
    expect(clean.rawPhones).toEqual([]);
  });

  it('matches phone numbers written with different spacing', () => {
    const clean = sanitizeExtraction(extraction({ rawPhones: ['+61-400-123-456'] }), SOURCE);
    expect(clean.rawPhones).toEqual(['+61-400-123-456']);
  });

  it('strips markup and control characters from names', () => {
    const clean = sanitizeExtraction(
      extraction({ fullName: '<b>Bold Name</b>\n\u0007 Extra' }),
      `${SOURCE}\nBold Name`
    );
    expect(clean.fullName).toBe('Bold Name Extra');
  });

  it('caps a very long name instead of storing it whole', () => {
    const clean = sanitizeExtraction(extraction({ fullName: 'A'.repeat(500) }), SOURCE);
    expect(clean.fullName!.length).toBeLessThanOrEqual(121);
  });

  it('falls back to placeholders when the model returns nothing usable', () => {
    const clean = sanitizeExtraction(
      extraction({
        currentCompanies: [
          { companyName: '', jobTitle: '', workPeriod: null, websiteUrl: null, roleSummary: '' },
        ],
      }),
      SOURCE
    );
    expect(clean.currentCompanies[0]).toMatchObject({
      companyName: 'Unspecified Company',
      jobTitle: 'Professional',
    });
  });
});
