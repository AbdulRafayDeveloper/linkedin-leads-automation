import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion, type LeadIngestionDocument } from '@/lib/db/models/LeadIngestion';
import { PromptSetting } from '@/lib/db/models/PromptSetting';
import { getFallbackChatModels } from '@/lib/ai/provider';
import mongoose from 'mongoose';

export interface EmailGeneratorModel {
  invoke: (prompt: string) => Promise<{ content: unknown } | string>;
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

  // Retrieve persistent global custom prompt setting
  const promptSetting = await PromptSetting.findOne({ key: 'global_outreach_prompt' });
  const globalPromptText = promptSetting?.promptText || '';

  const firstName = firstNameOf(doc.fullName || 'there');
  const candidateModels = models ?? (await getFallbackChatModels()) as unknown as EmailGeneratorModel[];

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

      for (const model of candidateModels) {
        try {
          const response = await model.invoke(prompt);
          const rawText = extractContent(response);
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (!jsonMatch) continue;

          const parsed = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
          if (!parsed.subject || !parsed.body) continue;

          let subject = stripDashes(parsed.subject);
          if (subject.length > 350) subject = subject.slice(0, 350);

          const cleanBody = ensureStartsWithFirstNameHtml(parsed.body, firstName);

          const targetComp = doc.currentCompanies[i];
          if (targetComp) {
            targetComp.emailSubject = subject;
            targetComp.emailBody = cleanBody;
            targetComp.approved = false;
            doc.markModified('currentCompanies');
          }
          break;
        } catch {
          // try next model
        }
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

      for (const model of candidateModels) {
        try {
          const response = await model.invoke(prompt);
          const rawText = extractContent(response);
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (!jsonMatch) continue;

          const parsed = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
          if (!parsed.subject || !parsed.body) continue;

          let subject = stripDashes(parsed.subject);
          if (subject.length > 350) subject = subject.slice(0, 350);

          doc.emailSubject = subject;
          doc.emailBody = ensureStartsWithFirstNameHtml(parsed.body, firstName);
          doc.emailStatus = 'pending';
          doc.approved = false;
          break;
        } catch {
          // try next model
        }
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
