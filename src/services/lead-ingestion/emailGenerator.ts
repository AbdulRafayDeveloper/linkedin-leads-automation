import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion, type LeadIngestionDocument } from '@/lib/db/models/LeadIngestion';
import { getFallbackChatModels } from '@/lib/ai/provider';
import { senderProfile, formatSenderSignature, type SenderProfile } from '@/lib/config/senderProfile';
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

  // If already starts with a paragraph tag enclosing "hi firstName"
  if (/^<p>\s*hi\s+\w+/i.test(lowerTrimmed)) {
    return trimmed;
  }

  // Convert raw signature linebreaks or standard text to HTML paragraphs if not present
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

export function buildOutreachPrompt(
  recipientFirstName: string,
  summary: string,
  websiteUrl: string | null,
  sender: SenderProfile,
  userPrompt?: string
): string {
  let prompt = `You are ${sender.name}, a ${sender.title}. Context about you: ${sender.positioning.join('; ')}.

You are writing a short, highly personalized cold outreach email in clean HTML.

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
6. Do NOT include any signature, sign-off, or links in the body; those are added separately.`;

  if (userPrompt && userPrompt.trim()) {
    prompt += `\n\nSpecial style/type instructions requested by the user: "${userPrompt.trim()}"\nFollow these style instructions strictly when drafting the email.`;
  }

  prompt += `\n\nRespond ONLY with strict JSON in this exact shape:
{"subject": "...", "body": "..."}`;

  return prompt;
}

export async function generateLeadEmail(
  leadId: string,
  userPrompt?: string,
  models?: EmailGeneratorModel[],
  sender: SenderProfile = senderProfile
): Promise<LeadIngestionDocument> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    throw new Error('Invalid lead ID');
  }

  const doc = await LeadIngestion.findById(leadId);
  if (!doc) {
    throw new Error('Lead ingestion record not found');
  }

  const firstName = firstNameOf(doc.fullName || 'there');
  const summary = doc.summary || 'No details available.';
  const prompt = buildOutreachPrompt(firstName, summary, doc.websiteUrl, sender, userPrompt);

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

      let subject = stripDashes(parsed.subject);
      if (subject.length > 350) subject = subject.slice(0, 350);

      // Append signature to HTML body
      const cleanBody = ensureStartsWithFirstNameHtml(parsed.body, firstName);
      const signatureHtml = `<p>${formatSenderSignature(sender).replace(/\n/g, '<br />')}</p>`;
      const fullHtmlBody = `${cleanBody}\n\n${signatureHtml}`;

      doc.emailSubject = subject;
      doc.emailBody = fullHtmlBody;
      doc.emailStatus = 'draft';

      return await doc.save();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'unknown error');
    }
  }

  throw new Error(`AI email generation failed on all providers: ${errors.join('; ')}`);
}

export async function refineEmailWithAi(
  leadId: string,
  refinementPrompt: string,
  models?: EmailGeneratorModel[],
  sender: SenderProfile = senderProfile
): Promise<LeadIngestionDocument> {
  await connectToMongoDB();

  if (!mongoose.Types.ObjectId.isValid(leadId)) {
    throw new Error('Invalid lead ID');
  }

  const doc = await LeadIngestion.findById(leadId);
  if (!doc) {
    throw new Error('Lead ingestion record not found');
  }

  const currentSubject = doc.emailSubject || '(no subject)';
  const currentBody = doc.emailBody || '(no body)';

  const prompt = `You are ${sender.name}, a ${sender.title}. Context about you: ${sender.positioning.join('; ')}.

You are refining a cold outreach email draft for a lead.

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

      doc.emailSubject = stripDashes(parsed.subject);
      doc.emailBody = parsed.body;
      return await doc.save();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'unknown error');
    }
  }

  throw new Error(`AI email refinement failed on all providers: ${errors.join('; ')}`);
}
