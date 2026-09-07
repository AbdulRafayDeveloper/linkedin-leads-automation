import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface PromptSettingDocument extends Document {
  key: string;
  promptText: string;
  senderName: string;
  senderTitle: string;
  senderPositioning: string;
  senderPortfolioUrl: string;
  senderLinkedinUrl: string;
  senderPhone: string;
  updatedAt: Date;
  createdAt: Date;
}

const PromptSettingSchema = new Schema<PromptSettingDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'global_outreach_prompt' },
    promptText: {
      type: String,
      default: 'Focus on highlighting custom software development capabilities, speed of delivery, and professional partnership.',
    },
    senderName: { type: String, default: 'Abdul Rafay' },
    senderTitle: { type: String, default: 'Senior Full Stack AI Developer' },
    senderPositioning: {
      type: String,
      default: 'builds production web and AI applications|has shipped 70+ production-ready SaaS products and MVPs|works hands-on with real-world production systems',
    },
    senderPortfolioUrl: { type: String, default: 'https://rafaytech.vercel.app' },
    senderLinkedinUrl: { type: String, default: 'https://www.linkedin.com/in/abdulrafay-ai-mern' },
    senderPhone: { type: String, default: '+92 306 0815246' },
  },
  { timestamps: true }
);

export const PromptSetting: Model<PromptSettingDocument> =
  (mongoose.models.PromptSetting as Model<PromptSettingDocument>) ||
  mongoose.model<PromptSettingDocument>('PromptSetting', PromptSettingSchema);
