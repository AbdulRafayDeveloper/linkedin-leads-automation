import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion, type LeadIngestionDocument } from '@/lib/db/models/LeadIngestion';
import { getFallbackChatModels } from '@/lib/ai/provider';
import { PROMPT_KEYS } from '@/services/prompts/definitions';
import { getPromptText } from '@/services/prompts/promptStore';
import { htmlToPlainText } from './emailHtml';
import mongoose from 'mongoose';

export interface EmailGeneratorModel {
  invoke: (prompt: string) => Promise<{ content: unknown } | string>;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed || trimmed === 'UNCERTAIN') return 'there';
  return trimmed.split(/\s+/)[0];
}

function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/(?<=\S)\s-\s(?=\S)/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
}

function ensureStartsWithFirstNameHtml(bodyHtml: string, firstName: string): string {
  const trimmed = bodyHtml.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  if (/^<p>\s*hi\s+\w+/i.test(lowerTrimmed)) {
    return trimmed;
  }

  if (!trimmed.startsWith('<p>')) {
    const paragraphs = trimmed
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, '<br />')}</p>`)
      .join('\n');
    return `<p>Hi ${firstName},</p>\n\n${paragraphs}`;
  }

  return `<p>Hi ${firstName},</p>\n\n${trimmed}`;
}

function extractContent(raw: { content: unknown } | string): string {
  if (typeof raw === 'string') return raw;
  const { content } = raw;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part as { text?: string }).text || ''))
      .join('');
  }
  return '';
}

/**
 * The global prompt from AI Settings (plus any per-request prompt) is the only
 * sender context the AI gets: there is no separate sender profile or appended
 * signature, so the sign-off has to come from those instructions.
 */
export function buildOutreachPrompt(
  recipientFirstName: string,
  summary: string,
  websiteUrl: string | null,
  userPrompt?: string,
  globalPromptText?: string
): string {
  let prompt = `You are writing a short, highly personalized cold outreach email in clean HTML on behalf of the sender described in the instructions below.

Recipient's first name: ${recipientFirstName}
Recipient's company details/summary: ${summary}
Recipient's company website: ${websiteUrl || 'Not found'}

Your task: Pick one specific detail from the recipient's details/summary above and build both the subject line and the opening line of the email around it. Be specific, not generic.

Writing rules (follow exactly):
1. Write the body in clean, professional HTML (using standard tags like <p>, <strong>, <em>, <u> for formatting).
2. Do NOT wrap the output in <html>, <head>, or <body> tags. Just output the HTML paragraph tags directly.
3. Start the body with a paragraph: "<p>Hi [Recipient's first name],</p>".
4. Subject line: maximum 350 characters, specific to this lead, no dashes or em-dashes.
5. Body: short, clear, conversational. Under 20 seconds to read.
6. End the email with the sign-off, name and contact details described in the sender's instructions below. If they don't describe one, end with a short sign-off. Never invent contact details and never use placeholders like [Your Name].`;

  const combinedCustomInstruction = [globalPromptText, userPrompt]
    .filter(Boolean)
    .join('\n')
    .trim();

  if (combinedCustomInstruction) {
    prompt += `\n\nMandatory Sender, Style & Pitch Instructions (Apply Strictly; they override the writing rules above if they conflict):\n"""\n${combinedCustomInstruction}\n"""`;
  }

  prompt += `\n\nRespond ONLY with strict JSON in this exact shape:
{"subject": "...", "body": "..."}`;

  return prompt;
}

/** Tries each model in turn and returns the first valid {"subject", "body"} answer. */
async function requestEmailJson(models: EmailGeneratorModel[], prompt: string): Promise<EmailDraft | null> {
  for (const model of models) {
    try {
      const rawText = extractContent(await model.invoke(prompt));
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]) as Partial<EmailDraft>;
      if (typeof parsed.subject === 'string' && typeof parsed.body === 'string' && parsed.subject.trim() && parsed.body.trim()) {
        return { subject: parsed.subject, body: parsed.body };
      }
    } catch {
      // try next model
    }
  }
  return null;
}

/**
 * Step 2 prompt: the user's format rules (AI Settings → Email format check
 * prompt) wrapped with the fixed parts: the draft, "fix the format only" and
 * the JSON answer shape.
 */
export function buildFormatCheckPrompt(draft: EmailDraft, formatRules: string): string {
  return `You check the format of a cold email before it is saved. You fix formatting only; you never rewrite it.

Format rules (apply strictly):
"""
${formatRules.trim()}
"""

Email to check:
Subject: ${draft.subject}
HTML body:
"""
${draft.body}
"""

If the email already follows the format rules, return it exactly as it is. If it doesn't, change only its structure, spacing and HTML tags so it does. Keep every word, name, number, link and phone number exactly as written.

Respond ONLY with strict JSON in this exact shape:
{"subject": "...", "body": "..."}`;
}

function wordsOf(text: string): string[] {
  return htmlToPlainText(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * True when `formatted` keeps the draft's wording: at least 85% of its words
 * survive and not many are added. Guards against the format check rewriting,
 * cutting or padding the email.
 */
export function keepsWording(draft: EmailDraft, formatted: EmailDraft): boolean {
  const original = [...wordsOf(draft.subject), ...wordsOf(draft.body)];
  const next = [...wordsOf(formatted.subject), ...wordsOf(formatted.body)];
  if (original.length === 0) return true;

  const available = new Map<string, number>();
  for (const word of next) available.set(word, (available.get(word) ?? 0) + 1);
  let kept = 0;
  for (const word of original) {
    const count = available.get(word) ?? 0;
    if (count > 0) {
      kept++;
      available.set(word, count - 1);
    }
  }
  return kept / original.length >= 0.85 && next.length <= original.length * 1.25 + 10;
}

/**
 * Step 2: a second AI call checks the draft against the format rules and fixes
 * only the format. Returns the draft unchanged when the rules are empty (the
 * step is off), every model fails, or the answer changes the wording.
 */
export async function checkEmailFormat(
  draft: EmailDraft,
  formatRules: string,
  models: EmailGeneratorModel[]
): Promise<EmailDraft> {
  if (!formatRules.trim()) return draft;

  const formatted = await requestEmailJson(models, buildFormatCheckPrompt(draft, formatRules));
  if (!formatted) return draft;
  if (!keepsWording(draft, formatted)) {
    console.warn('Email format check changed the wording; keeping the original draft.');
    return draft;
  }
  return formatted;
}

export async function generateLeadEmail(
  leadId: string,
  options: {
    userPrompt?: string;
    companyIndex?: number;
    forceRegenerate?: boolean;
    models?: EmailGeneratorModel[];
  } = {}
): Promise<LeadIngestionDocument> {
  const { userPrompt, companyIndex, forceRegenerate = false, models } = options;
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    throw new Error('Invalid lead ID');
  }

  const doc = await LeadIngestion.findById(leadId);
  if (!doc) {
    throw new Error('Lead ingestion record not found');
  }

  // The two prompts from AI Settings: step 1 writes, step 2 checks the format.
  const [globalPromptText, formatRules] = await Promise.all([
    getPromptText(PROMPT_KEYS.emailWriting),
    getPromptText(PROMPT_KEYS.emailFormat),
  ]);

  const firstName = firstNameOf(doc.fullName || 'there');
  const candidateModels = models ?? (await getFallbackChatModels()) as unknown as EmailGeneratorModel[];

  /** Writes one email (step 1), checks its format (step 2), then applies the fixed guards. */
  const writeEmail = async (prompt: string): Promise<EmailDraft | null> => {
    const draft = await requestEmailJson(candidateModels, prompt);
    if (!draft) return null;

    const checked = await checkEmailFormat(draft, formatRules, candidateModels);
    let subject = stripDashes(htmlToPlainText(checked.subject).replace(/\s+/g, ' '));
    if (subject.length > 350) subject = subject.slice(0, 350);
    return { subject, body: ensureStartsWithFirstNameHtml(checked.body, firstName) };
  };

  const companies = doc.currentCompanies ?? [];
  const isTargetingSpecificCompany = typeof companyIndex === 'number' && companyIndex >= 0;
  const isTargetingPersonalOnly = companyIndex === -1;

  // ── 1. Generate Company Outreach Drafts ─────────────────────────────────────
  if (!isTargetingPersonalOnly) {
    const targetIndices = isTargetingSpecificCompany
      ? [companyIndex]
      : companies.map((_, idx) => idx);

    for (const i of targetIndices) {
      const comp = companies[i];
      if (!comp) continue;

      // Skip only if draft already exists AND no explicit userPrompt AND not forceRegenerate
      if (comp.emailSubject && comp.emailBody && !userPrompt && !forceRegenerate) {
        continue;
      }

      const compName = comp.companyName || 'Company';
      const compJob = comp.jobTitle || 'Professional';
      const roleDetails = comp.summary || (comp as unknown as { roleSummary?: string }).roleSummary || '';
      const compSummary = `${doc.summary || ''}${roleDetails ? ` | Role details: ${roleDetails}` : ''} | Target Company: ${compName} (${compJob})`;
      const prompt = buildOutreachPrompt(firstName, compSummary, comp.websiteUrl, userPrompt, globalPromptText);
      const email = await writeEmail(prompt);

      const targetComp = doc.currentCompanies[i];
      if (email && targetComp) {
        targetComp.emailSubject = email.subject;
        targetComp.emailBody = email.body;
        targetComp.approved = false;
        doc.markModified('currentCompanies');
      }
    }
  }

  // ── 2. Generate Personal Outreach Draft ────────────────────────────────────
  // Always generated when not targeting a specific company position (or when explicitly requested via index -1)
  if (!isTargetingSpecificCompany) {
    const personalDraftMissing = !doc.emailSubject || !doc.emailBody;
    const shouldWritePersonalDraft = personalDraftMissing || !!userPrompt || forceRegenerate || isTargetingPersonalOnly;

    if (shouldWritePersonalDraft) {
      const personalSummary = doc.summary || `${firstName} is a professional. Outreach via direct personal inbox.`;
      const personalWebsite = doc.portfolioUrl || null;
      const prompt = buildOutreachPrompt(
        firstName,
        personalSummary,
        personalWebsite,
        userPrompt,
        globalPromptText
      );
      const email = await writeEmail(prompt);

      if (email) {
        doc.emailSubject = email.subject;
        doc.emailBody = email.body;
        doc.emailStatus = 'pending';
        doc.approved = false;
      }
    }
  }

  doc.markModified('currentCompanies');
  return await doc.save();
}


export async function refineEmailWithAi(
  leadId: string,
  refinementPrompt: string,
  modelsOrOptions?: EmailGeneratorModel[] | { companyIndex?: number; models?: EmailGeneratorModel[] },
  companyIndexParam?: number
): Promise<LeadIngestionDocument> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    throw new Error('Invalid lead ID');
  }

  const doc = await LeadIngestion.findById(leadId);
  if (!doc) {
    throw new Error('Lead ingestion record not found');
  }

  let companyIndex: number | undefined = companyIndexParam;
  let models: EmailGeneratorModel[] | undefined;

  if (modelsOrOptions && !Array.isArray(modelsOrOptions) && typeof modelsOrOptions === 'object') {
    companyIndex = modelsOrOptions.companyIndex ?? companyIndexParam;
    models = modelsOrOptions.models;
  } else if (Array.isArray(modelsOrOptions)) {
    models = modelsOrOptions;
  }

  const isTargetingCompany = typeof companyIndex === 'number' && companyIndex >= 0;
  const targetComp = isTargetingCompany && typeof companyIndex === 'number' ? doc.currentCompanies?.[companyIndex] : null;

  const currentSubject = isTargetingCompany
    ? (targetComp?.emailSubject || '(no subject)')
    : (doc.emailSubject || '(no subject)');
  const currentBody = isTargetingCompany
    ? (targetComp?.emailBody || '(no body)')
    : (doc.emailBody || '(no body)');

  const prompt = `You are refining a cold outreach email draft for a lead.

Current Subject: "${currentSubject}"
Current HTML Body: "${currentBody}"

User Refinement Request: "${refinementPrompt}"

Your task: Rewrite both the subject line and the HTML body to satisfy the user's refinement request.

Writing rules:
1. Return the body in clean, professional HTML (using tags like <p>, <strong>, <em>, <u>). Do NOT include <html>/<body> wrappers.
2. Maintain the recipient's greeting and your signature block at the bottom, updating them only if explicitly requested.
3. Keep the body text conversational, professional, and readable under 20 seconds.

Respond ONLY with strict JSON in this exact shape:
{"subject": "...", "body": "..."}`;

  const candidateModels = models ?? (await getFallbackChatModels()) as unknown as EmailGeneratorModel[];
  const errors: string[] = [];

  for (const model of candidateModels) {
    try {
      const response = await model.invoke(prompt);
      const rawText = extractContent(response);
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Model did not return JSON');

      const parsed = JSON.parse(jsonMatch[0]) as {
        subject: string;
        body: string;
      };

      if (!parsed.subject || !parsed.body) {
        throw new Error('Incomplete subject or body');
      }

      if (isTargetingCompany && targetComp) {
        targetComp.emailSubject = stripDashes(parsed.subject);
        targetComp.emailBody = parsed.body;
        doc.markModified('currentCompanies');
      } else {
        doc.emailSubject = stripDashes(parsed.subject);
        doc.emailBody = parsed.body;
      }
      return await doc.save();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'unknown error');
    }
  }

  throw new Error(`AI email refinement failed on all providers: ${errors.join('; ')}`);
}
