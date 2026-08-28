import { connectToMongoDB } from '@/lib/db/connection';
import { Lead, type LeadDocument } from '@/lib/db/models/Lead';
import type { ApprovalStatus } from '@/lib/types/lead';

export async function deleteLead(id: string): Promise<LeadDocument | null> {
  await connectToMongoDB();
  return Lead.findByIdAndDelete(id);
}

export async function deleteLeadsByIds(ids: string[]): Promise<{ deletedCount: number }> {
  await connectToMongoDB();
  const result = await Lead.deleteMany({ _id: { $in: ids } });
  return { deletedCount: result.deletedCount ?? 0 };
}

export async function deleteLeadsByApprovalStatus(
  status: ApprovalStatus
): Promise<{ deletedCount: number }> {
  await connectToMongoDB();
  const result = await Lead.deleteMany({ approvalStatus: status });
  return { deletedCount: result.deletedCount ?? 0 };
}
