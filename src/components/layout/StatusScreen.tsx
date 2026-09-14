import type { ReactNode } from 'react';
import { BrandMark } from '@/components/sidebar/Brand';

/** Full-page message with the logo, for 404 and error pages. */
export default function StatusScreen({
  code,
  title,
  description,
  actions,
}: {
  code: string;
  title: string;
  description: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-16 text-center">
      <BrandMark size={56} />
      <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">{code}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>
    </div>
  );
}
