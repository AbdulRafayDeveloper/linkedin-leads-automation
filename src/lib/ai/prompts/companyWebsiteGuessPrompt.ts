export interface CompanyWebsiteGuessContext {
  location?: string | null;
  title?: string | null;
  headline?: string | null;
  about?: string | null;
}

/**
 * Prompt asking the model to name a company's real website domain from its
 * own training knowledge. Kept separate from web search so a company that is
 * hard to find via scraping (or whose name collides with an unrelated,
 * better-known company) can still be identified from context.
 */
export function buildCompanyWebsiteGuessPrompt(
  companyName: string,
  context: CompanyWebsiteGuessContext
): string {
  const details = [
    context.location ? `Company location: ${context.location}` : null,
    context.title ? `Person's current title: ${context.title}` : null,
    context.headline ? `Person's headline: ${context.headline}` : null,
    context.about ? `Person's about/bio: ${context.about}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `You are identifying the official website domain for a specific real company, using only your own knowledge of real companies and domains.

Company name: "${companyName}"
${details || 'No further context is available.'}

Some company names are shared by multiple unrelated companies (for example a large well-known company and a smaller, newer one). Use the location and context above to identify the SPECIFIC company being referred to, not just the most famous company with that name.

Return ONLY a strict JSON array (no markdown, no commentary before or after it) of up to 3 candidate root domains, ordered from most to least likely, for example: ["examplecompany.com", "examplecompany.co"]. Only include a domain if you are reasonably confident it is real and matches this specific company and context. If you do not know or are not confident, return an empty array: []`;
}
