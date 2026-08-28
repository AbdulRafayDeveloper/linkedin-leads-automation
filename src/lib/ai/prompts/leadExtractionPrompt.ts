/**
 * Prompt for AI-based Sales Navigator lead extraction. Kept in its own file
 * so the extraction behavior can be tuned without touching the calling code
 * or swapping the underlying model.
 */
export function buildLeadExtractionPrompt(rawContent: string): string {
  return `You are extracting structured information from a pasted LinkedIn Sales Navigator lead page. The raw text below mixes real profile content with unrelated navigation, UI labels, and noise (menus, notification counts, "Show more" buttons, endorsement counts, other people's profiles, etc.).

Read the raw text and return ONLY a single strict JSON object (no markdown, no code fences, no commentary before or after it) with exactly these keys:

{
  "fullName": string,
  "linkedinProfileUrl": string or null,
  "headline": string or null,
  "currentTitle": string or null,
  "currentCompany": string or null,
  "currentCompanyLinkedInUrl": string or null,
  "currentCompanyWebsite": string or null,
  "currentCompanyLocation": string or null,
  "location": string or null,
  "currentRoleStartDate": string or null,
  "about": string or null,
  "experience": string[],
  "education": string[],
  "skills": string[],
  "recentActivity": string[],
  "publicEmail": string or null
}

Rules:
- "currentCompany" and "currentTitle" must reflect the person's CURRENT employer and role: the one marked "Present" or with the most recent/ongoing date range. If the person holds multiple current roles at different companies, pick the first/primary one listed (usually their most senior title, e.g. Founder/CEO).
- "currentCompanyWebsite" is the official company website URL only if one literally appears in the text (for example near "Contact information" or "website"). If none appears, return null. Never invent or guess a website.
- "currentCompanyLocation" is the CURRENT COMPANY's own location/headquarters (city, state/region, country), if it is stated anywhere in the text (for example next to the current role entry, or in the experience section next to that specific company). This is the company's location, not the person's personal location field above it. If the text only gives the person's own location and never states where the company itself is based, return null. Never invent or guess a location.
- "publicEmail" is an email address only if one is literally present in the text (for example under "Contact information"). If none appears, return null. Never invent an email address.
- "experience" lists each past/current role as one short string (title, company, and dates if available), in the order they appear.
- "education" lists each degree/institution as one short string.
- "skills" lists the person's listed skills only (ignore endorsement counts).
- "recentActivity" summarizes posts/comments/shares attributed to this person (ignore reaction counts and empty "No comments" markers).
- "about" is the person's About/bio section text if present, otherwise null.
- Ignore navigation menus, notification counts, "Show more"/"See all" buttons, other people shown as shared connections or interests, and any UI chrome unrelated to this specific lead.
- Never fabricate a value that is not present in the text. Use null for missing scalar fields and an empty array for missing list fields.

Raw pasted content:
"""
${rawContent}
"""

Return only the JSON object.`;
}
