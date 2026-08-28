export interface CompanyWebsiteVerificationInput {
  companyName: string;
  companyLocation?: string | null;
  personName?: string | null;
  personTitle?: string | null;
  personHeadline?: string | null;
  about?: string | null;
  websiteUrl: string;
  pageContent: string;
}

/**
 * Prompt asking the model to confirm whether a candidate website's homepage
 * content actually belongs to the specific company in question, not just
 * any company with a similar name. Kept separate from the discovery prompt
 * so verification wording can be tuned independently of how candidates are
 * found.
 */
export function buildCompanyWebsiteVerificationPrompt(input: CompanyWebsiteVerificationInput): string {
  const personContext = [
    input.personName ? `Person: ${input.personName}` : null,
    input.personTitle ? `Person's title: ${input.personTitle}` : null,
    input.personHeadline ? `Person's headline: ${input.personHeadline}` : null,
    input.about ? `Person's about/bio: ${input.about}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `You are verifying whether a website is the correct, official website for one specific company, not just any company that happens to share a similar name.

Company name to verify: "${input.companyName}"
${input.companyLocation ? `Company location: ${input.companyLocation}` : 'Company location: unknown'}
${personContext ? `Additional context about a person who works at this company:\n${personContext}` : ''}

Website being checked: ${input.websiteUrl}

Extracted homepage text from that website:
"""
${input.pageContent.slice(0, 4000)}
"""

Decide whether this homepage content clearly describes THIS SPECIFIC company, matching the name and, where mentioned, the location or industry. Do not treat a different, unrelated company that happens to share a similar or identical name as a match. Do not treat a parked, placeholder, or unrelated page as a match.

Return ONLY strict JSON in this exact shape (no markdown, no commentary before or after it):
{"isMatch": true or false, "reasoning": "one short sentence explaining why"}

Rules:
- "isMatch" must be true only if you are confident, based on the extracted text above, that this is the official website of this specific company.
- If the homepage content does not mention the company at all, clearly describes a different/unrelated company, or there simply is not enough information to be confident, return false.
- Never guess in favor of a match when uncertain.`;
}
