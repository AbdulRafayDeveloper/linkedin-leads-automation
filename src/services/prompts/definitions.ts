/**
 * Every prompt that can be edited on AI Settings (/lead-ingestion/prompt).
 * Each one is stored as a PromptSetting document under its `key`; until it is
 * saved, `defaultText` is used. To add a prompt, add an entry here and read it
 * with getPromptText(key). The settings page lists whatever is defined here.
 */

export const PROMPT_KEYS = {
  /** Step 1: the pitch, voice and sign-off the AI writes every email with. */
  emailWriting: 'global_outreach_prompt',
  /** Step 2: the format rules a second AI call checks and fixes every email against. */
  emailFormat: 'email_format_check_prompt',
} as const;

export type PromptKey = (typeof PROMPT_KEYS)[keyof typeof PROMPT_KEYS];

export interface PromptDefinition {
  key: PromptKey;
  title: string;
  /** What the prompt controls, shown on its card. */
  description: string;
  /** Where it runs, shown as a badge, e.g. "Step 1 · Writes the email". */
  stage: string;
  /** What leaving the prompt empty does. */
  emptyBehavior: string;
  defaultText: string;
}

const EMAIL_FORMAT_DEFAULT = `Check that the email follows this exact structure and fix only what does not.

SUBJECT
- One line of plain text: no HTML, no "Subject:" label, no quotes, no line breaks.
- No dashes or em dashes, no emojis, no trailing period.

BODY (HTML), in this order:
1. Greeting on its own paragraph: <p>Hi FirstName,</p>
2. The message, each paragraph in its own <p>...</p>. Usually two paragraphs: the opening line, then the proof, the offer and the call to action.
3. Sign-off on its own paragraph, with the name on the next line: <p>Best regards,<br>Full Name</p>
4. Contact details in one paragraph, one detail per line: <p>Portfolio: ...<br>LinkedIn: ...<br>Phone / WhatsApp: ...</p>
5. Optional PS, always last: <p>PS: ...</p>

SPACING
- Every paragraph is its own <p>. The app and the sent email show one blank line between paragraphs, so never add empty <p></p>, <p>&nbsp;</p> or <br><br> to make space.
- Use <br> only inside the sign-off and the contact details.
- No text outside a <p>. No <div>, no markdown (**, #, bullet lists), no <html>, <head>, <body> or <style> tags.
- Allowed inside a paragraph: <strong>, <em>, <u>, <a>, <br>.

WHAT TO FIX
- A paragraph built from lines joined with <br>: make it a proper <p>.
- Two paragraphs inside one <p>: split them.
- Sign-off or contact details stuck to the last paragraph: move them into their own paragraphs as above.
- Empty paragraphs or <br><br> used as spacers: remove them.
- Leftover labels or notes such as "SUBJECT:", "Body:", word counts or "[Your Name]": remove them.

Change only structure, spacing and tags. Keep every word, name, number, link and phone number exactly as written.`;

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    key: PROMPT_KEYS.emailWriting,
    title: 'Email writing prompt',
    description:
      'Who you are, your pitch, tone, call to action and sign-off. The AI writes every lead email with it, first time and on regenerate.',
    stage: 'Step 1 · Writes the email',
    emptyBehavior: 'Empty: the AI writes with its built-in rules only.',
    defaultText:
      'Focus on highlighting custom software development capabilities, speed of delivery, and professional partnership.',
  },
  {
    key: PROMPT_KEYS.emailFormat,
    title: 'Email format check prompt',
    description:
      'The structure and spacing every email must follow. A second AI call checks each new email against it and fixes only the format, never the wording.',
    stage: 'Step 2 · Checks the format',
    emptyBehavior: 'Empty: the format check is skipped.',
    defaultText: EMAIL_FORMAT_DEFAULT,
  },
];

export function getPromptDefinition(key: string): PromptDefinition | undefined {
  return PROMPT_DEFINITIONS.find((definition) => definition.key === key);
}

/** Longest prompt that can be saved, to keep requests and LLM calls sane. */
export const MAX_PROMPT_LENGTH = 50_000;
