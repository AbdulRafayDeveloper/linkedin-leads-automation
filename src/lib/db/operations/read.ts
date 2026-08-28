import { connectToMongoDB } from '@/lib/db/connection';
import { Lead, type LeadDocument } from '@/lib/db/models/Lead';
import type {
  ApprovalStatus,
  PaginatedResult,
  SentStatus,
  ValidationStatus,
} from '@/lib/types/lead';

const DEFAULT_LIMIT = Number(process.env.ITEMS_PER_PAGE) || 50;

export async function getLeads(
  page = 1,
  limit = DEFAULT_LIMIT
): Promise<PaginatedResult<LeadDocument>> {
  await connectToMongoDB();
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * limit;

  const [leads, total] = await Promise.all([
    Lead.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    Lead.countDocuments(),
  ]);

  return { leads, total, page: safePage, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getLeadById(id: string): Promise<LeadDocument | null> {
  await connectToMongoDB();
  return Lead.findById(id);
}

export async function searchLeads(query: string): Promise<LeadDocument[]> {
  await connectToMongoDB();
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  return Lead.find({ $or: [{ email: regex }, { fullName: regex }] }).sort({ createdAt: -1 });
}

export async function getLeadsByApprovalStatus(
  status: ApprovalStatus,
  page = 1,
  limit = DEFAULT_LIMIT
): Promise<PaginatedResult<LeadDocument>> {
  await connectToMongoDB();
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * limit;
  const filter = { approvalStatus: status };

  const [leads, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Lead.countDocuments(filter),
  ]);

  return { leads, total, page: safePage, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getLeadsByValidationStatus(status: ValidationStatus): Promise<LeadDocument[]> {
  await connectToMongoDB();
  return Lead.find({ validationStatus: status }).sort({ createdAt: -1 });
}

export async function getLeadsBySentStatus(status: SentStatus): Promise<LeadDocument[]> {
  await connectToMongoDB();
  return Lead.find({ sentStatus: status }).sort({ createdAt: -1 });
}

export async function getLeadsByDateRange(startDate: Date, endDate: Date): Promise<LeadDocument[]> {
  await connectToMongoDB();
  return Lead.find({ createdAt: { $gte: startDate, $lte: endDate } }).sort({ createdAt: -1 });
}

export interface LeadFilters {
  approvalStatus?: ApprovalStatus;
  validationStatus?: ValidationStatus;
  sentStatus?: SentStatus;
  search?: string;
  startDate?: Date;
  endDate?: Date;
}

export async function getFilteredLeads(
  filters: LeadFilters,
  page = 1,
  limit = DEFAULT_LIMIT
): Promise<PaginatedResult<LeadDocument>> {
  await connectToMongoDB();
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * limit;

  const query: Record<string, unknown> = {};
  if (filters.approvalStatus) query.approvalStatus = filters.approvalStatus;
  if (filters.validationStatus) query.validationStatus = filters.validationStatus;
  if (filters.sentStatus) query.sentStatus = filters.sentStatus;
  if (filters.startDate || filters.endDate) {
    query.createdAt = {
      ...(filters.startDate ? { $gte: filters.startDate } : {}),
      ...(filters.endDate ? { $lte: filters.endDate } : {}),
    };
  }
  if (filters.search) {
    const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');
    query.$or = [{ email: regex }, { fullName: regex }];
  }

  const [leads, total] = await Promise.all([
    Lead.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Lead.countDocuments(query),
  ]);

  return { leads, total, page: safePage, pages: Math.max(1, Math.ceil(total / limit)) };
}
