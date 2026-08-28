/**
 * The sender's own bio/positioning and contact links, used to personalize
 * outreach emails. Kept out of the AI prompt itself so it can be updated
 * (via environment variables) without touching prompt or generation logic.
 */
export interface SenderProfile {
  name: string;
  title: string;
  positioning: string[];
  portfolioUrl: string;
  linkedinUrl: string;
  phone: string;
}

function parsePositioning(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const senderProfile: SenderProfile = {
  name: process.env.SENDER_NAME || 'Abdul Rafay',
  title: process.env.SENDER_TITLE || 'Senior Full Stack AI Developer',
  positioning: parsePositioning(process.env.SENDER_POSITIONING, [
    'builds production web and AI applications',
    'has shipped 70+ production-ready SaaS products and MVPs',
    'works hands-on with real-world production systems',
  ]),
  portfolioUrl: process.env.SENDER_PORTFOLIO_URL || 'https://rafaytech.vercel.app',
  linkedinUrl: process.env.SENDER_LINKEDIN_URL || 'https://www.linkedin.com/in/abdulrafay-ai-mern',
  phone: process.env.SENDER_PHONE || '+92 306 0815246',
};

/**
 * Renders the closing sign-off and contact links appended to every
 * generated email. Kept deterministic (not written by the AI) so links and
 * the phone number are always exactly correct, never paraphrased.
 */
export function formatSenderSignature(profile: SenderProfile = senderProfile): string {
  return [
    `Portfolio: ${profile.portfolioUrl}`,
    `LinkedIn: ${profile.linkedinUrl}`,
    `Phone / WhatsApp: ${profile.phone}`,
    '',
    `Best regards,`,
    profile.name,
  ].join('\n');
}
