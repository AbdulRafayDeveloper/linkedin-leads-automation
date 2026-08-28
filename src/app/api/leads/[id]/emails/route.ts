import type { NextRequest } from 'next/server';
import { getLeadById } from '@/lib/db/operations/read';
import { classifyEmailType } from '@/lib/email/emailUtils';
import { normalizeEmail } from '@/lib/email/emailUtils';
import { validateEmailForEntry } from '@/lib/email/validation';
import type { EmailEntrySubdocument } from '@/lib/db/models/Lead';
import { jsonError, jsonOk } from '@/lib/api/response';

export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ id: string }>;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email || !EMAIL_REGEX.test(email)) {
      return jsonError('Enter a valid email address', 400);
    }

    const lead = await getLeadById(id);
    if (!lead) return jsonError('Lead not found', 404);

    const normalized = normalizeEmail(email);
    const alreadyExists = lead.emails.some((entry) => normalizeEmail(entry.email) === normalized);
    if (alreadyExists) {
      return jsonError('This email has already been added', 409);
    }

    const validation = await validateEmailForEntry(email.toLowerCase());

    lead.emails.push({
      email: email.toLowerCase(),
      source: 'MANUAL',
      sourceUrl: null,
      emailType: classifyEmailType(email),
      validationStatus: validation.validationStatus,
      validationDetails: validation.validationDetails,
      discoveredAt: new Date(),
      validatedAt: new Date(),
    } as EmailEntrySubdocument);

    lead.emailDiscoveryStatus = 'emails_found';
    await lead.save();

    return jsonOk({ lead });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to add email', 500);
  }
}
