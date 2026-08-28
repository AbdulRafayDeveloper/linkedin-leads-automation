import { connectToMongoDB } from '@/lib/db/connection';
import { Lead, type LeadDocument } from '@/lib/db/models/Lead';
import type { ApprovalStatus, SentStatus } from '@/lib/types/lead';

export async function updateLead(
  id: string,
  updates: Partial<LeadDocument>
): Promise<LeadDocument | null> {
  await connectToMongoDB();
  return Lead.findByIdAndUpdate(id, updates, { returnDocument: 'after', runValidators: true });
}

export async function updateLeadEmail(
  id: string,
  email: string,
  subject: string,
  body: string
): Promise<LeadDocument | null> {
  return updateLead(id, { email, emailSubject: subject, emailBody: body });
}

export async function updateApprovalStatus(
  id: string,
  status: ApprovalStatus
): Promise<LeadDocument | null> {
  return updateLead(id, { approvalStatus: status });
}

export async function updateSentStatus(
  id: string,
  status: SentStatus
): Promise<LeadDocument | null> {
  const updates: Partial<LeadDocument> = { sentStatus: status };
  if (status === 'SENT') {
    updates.sentAt = new Date();
  }
  return updateLead(id, updates);
}
