import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { Campaign } from '@/lib/db/models/Campaign';
import { PRIVATE_ROBOTS } from '@/lib/seo/metadata';

// The page is a client component, so its metadata lives here. A campaign lists
// recipients, so it is never indexed.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let name: string | null = null;

  if (mongoose.Types.ObjectId.isValid(id)) {
    try {
      await connectToMongoDB();
      const campaign = await Campaign.findById(id).select('name').lean();
      name = campaign?.name?.trim() || null;
    } catch {
      // Fall back to the generic title.
    }
  }

  return {
    title: name ? `${name} · Campaigns` : 'Campaign',
    description: 'Campaign runner with send progress, delivery status and opens for each email.',
    robots: PRIVATE_ROBOTS,
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
