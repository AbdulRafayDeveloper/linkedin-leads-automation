import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface ClientDocument extends Document {
  baseName: string;    // e.g. "Travis James"
  name: string;        // e.g. "Travis James #01"
  serialNumber: number; // 1, 2, 3...
  createdAt: Date;
  updatedAt: Date;
}

const ClientSchema = new Schema<ClientDocument>(
  {
    baseName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    serialNumber: { type: Number, required: true, default: 1 },
  },
  { timestamps: true }
);

// Index so lookups by baseName are fast
ClientSchema.index({ baseName: 1, serialNumber: 1 });

export const Client: Model<ClientDocument> =
  (mongoose.models.Client as Model<ClientDocument>) ||
  mongoose.model<ClientDocument>('Client', ClientSchema);
