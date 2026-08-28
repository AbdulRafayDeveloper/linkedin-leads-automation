import type { SenderProfile } from '@/lib/config/senderProfile';

export interface OutreachPromptInput {
  recipientFirstName: string;
  signals: string[];
  sender: SenderProfile;
}

// Openers that read as a generic template with the name swapped in. The
// model is explicitly told never to use these.
export const BANNED_OPENING_PHRASES = [
  'I came across your profile',
  'I was impressed by your work',
  'I hope this email finds you well',
  'I wanted to reach out',
  'I noticed you work at',
  'I stumbled upon your profile',
];

// Style references only — the model must adapt these to the lead's actual
// facts rather than reusing them verbatim.
export const SUBJECT_STYLE_EXAMPLES = [
  'Would love to contribute at [Company]'
];

/**
 * Builds the prompt for generating a personalized cold-outreach subject and
 * body. Edit this file to change how future emails are written; no other
 * code needs to change. The model is asked for the subject and body only —
 * the sign-off and contact links are appended deterministically afterward
 * (see src/lib/config/senderProfile.ts) so they are never paraphrased.
 */
export function buildOutreachEmailPrompt({ recipientFirstName, signals, sender }: OutreachPromptInput): string {
  return `You are ${sender.name}, a ${sender.title}. About you, for context only: ${sender.positioning.join('; ')}.

You are writing a short, highly personalized cold outreach email to one specific person, not a mail-merge template.

Recipient's first name: ${recipientFirstName}

Only use the following verified facts about the recipient and their company. Never invent details that are not listed here:
${signals.length ? signals.map((s) => `- ${s}`).join('\n') : '- (no additional signals available; keep the email short, honest that you do not know much about them yet, but still personalized by name and role)'}

Your task: pick ONE specific, concrete detail from the verified facts above (a real project, a real post, a specific line from their bio, a specific thing their company does) and build both the subject line and the opening line of the email around that ONE detail. Be specific, not generic. A reader should be able to tell this email could only have been written about this exact person, not copy-pasted with the name swapped in.

Never use generic filler openings such as: ${BANNED_OPENING_PHRASES.map((p) => `"${p}"`).join(', ')}.

Subject line style to draw inspiration from (adapt to the actual facts above, never copy these verbatim):
${SUBJECT_STYLE_EXAMPLES.map((s) => `- "${s}"`).join('\n')}

Writing rules (follow exactly):
- Start the body with "Hi [Recipient's first name]," on its own line, followed by a blank line (1 line space) before starting the first paragraph.
- Put exactly one blank line (1 line space) between every paragraph.
- Subject line: maximum 350 characters, specific to this lead, no dashes or em-dashes.
- Body: minimal commas (only for genuine lists), no abbreviations or shortforms, no dashes or em-dashes, seamless and natural, conversational but professional language. Short enough to read in under 20 seconds.
- After the specific opening, naturally weave in who you are and why you might be relevant to THEM specifically, adapting your own introduction to their world. Do not phrase your introduction the same way every time.
- End with a soft, low-pressure call to action (for example asking if they would be open to a short conversation), not a hard sales pitch.
- Do NOT include any signature, sign-off (like "Best regards"), or any links or contact details in the body; those are added separately after your response.
- Do not fabricate any claim, activity, achievement, or detail about the recipient or about yourself that is not present in the verified facts or your own positioning above.

Respond ONLY with strict JSON in this exact shape:
{"subject": "...", "body": "...", "personalizationSignalsUsed": ["..."]}`;
}
