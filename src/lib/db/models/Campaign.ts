import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export type CampaignStatus = 'draft' | 'running' | 'completed' | 'paused';
export type CampaignItemStatus = 'pending' | 'sending' | 'delivered' | 'failed' | 'opened';

export interface CampaignItem {
  _id?: string | Types.ObjectId;
  leadId: Types.ObjectId;
  companyIndex: number;
  candidateName: string;
  clientName: string;
  companyName: string;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  status: CampaignItemStatus;
  errorMessage?: string | null;
  sentAt?: Date | null;
  openedAt?: Date | null;
}

export interface CampaignDocument extends Document {
  name: string;
  status: CampaignStatus;
  totalEmails: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  openedCount: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  items: CampaignItem[];
  createdAt: Date;
  updatedAt: Date;
}

const CampaignItemSchema = new Schema<CampaignItem>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: 'LeadIngestion', required: true, index: true },
    companyIndex: { type: Number, required: true, default: 0 },
    candidateName: { type: String, required: true },
    clientName: { type: String, required: true },
    companyName: { type: String, required: true },
    recipientEmail: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, required: true },
    bodyHtml: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'sending', 'delivered', 'failed', 'opened'],
      default: 'pending',
    },
    errorMessage: { type: String, default: null },
    sentAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
  },
  { _id: true }
);

const CampaignSchema = new Schema<CampaignDocument>(
  {
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['draft', 'running', 'completed', 'paused'],
      default: 'draft',
      index: true,
    },
    totalEmails: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    openedCount: { type: Number, default: 0 },
    minDelaySeconds: { type: Number, default: 60 },
    maxDelaySeconds: { type: Number, default: 600 },
    items: { type: [CampaignItemSchema], default: [] },
  },
  { timestamps: true }
);

export const Campaign: Model<CampaignDocument> =
  (mongoose.models.Campaign as Model<CampaignDocument>) ||
  mongoose.model<CampaignDocument>('Campaign', CampaignSchema);
