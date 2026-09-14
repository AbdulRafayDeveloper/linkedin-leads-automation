import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface PromptSettingDocument extends Document {
  key: string;
  promptText: string;
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
  },
  { timestamps: true }
);

export const PromptSetting: Model<PromptSettingDocument> =
  (mongoose.models.PromptSetting as Model<PromptSettingDocument>) ||
  mongoose.model<PromptSettingDocument>('PromptSetting', PromptSettingSchema);
