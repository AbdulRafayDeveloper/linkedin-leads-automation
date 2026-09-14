import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { PRIVATE_ROBOTS } from '@/lib/seo/metadata';

// The page is a client component, so its metadata lives here. A lead profile
// holds personal contact data, so it is never indexed.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let fullName: string | null = null;

  if (mongoose.Types.ObjectId.isValid(id)) {
    try {
      await connectToMongoDB();
      const lead = await LeadIngestion.findById(id).select('fullName').lean();
      fullName = lead?.fullName?.trim() || null;
    } catch {
      // Fall back to the generic title.
    }
  }

  return {
    title: fullName ? `${fullName} · Leads` : 'Lead Profile',
    description: 'Lead profile with current companies, verified emails and outreach drafts.',
    robots: PRIVATE_ROBOTS,
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
