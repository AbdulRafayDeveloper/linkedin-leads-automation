import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import { LOGO_SPARK_PATH, LOGO_STROKE_PATH, LOGO_STROKE_WIDTH } from '@/lib/brand/logo';
import { APP_HOME_PATH, SITE_NAME, SITE_TAGLINE } from '@/lib/config/site';

// The LeadForge mark, drawn from src/lib/brand/logo.ts (the same source as the
// favicons, app icons and social cards). The gradient is indigo-500 → violet-600,
// i.e. LOGO_GRADIENT, and the corner radius is 25% at every size, like the icon
// files. It is inline SVG, so it stays sharp on retina screens at any size.
// Size it with `size` (px), not h-/w- classes: cn() doesn't resolve Tailwind conflicts.
// Decorative by default; pass `label` when no visible text names it.
export function BrandMark({
  size = 32,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[25%] bg-linear-to-br from-indigo-500 to-violet-600',
        'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_6px_16px_-6px_rgba(99,102,241,0.7)]',
        className
      )}
    >
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className="h-full w-full">
        <path
          d={LOGO_STROKE_PATH}
          stroke="white"
          strokeWidth={LOGO_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d={LOGO_SPARK_PATH} fill="white" />
      </svg>
    </span>
  );
}

/** Logo, name and tagline, linking to the app's home page. */
export default function Brand({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return (
    <Link href={APP_HOME_PATH} className="flex min-w-0 items-center gap-2.5 rounded-md outline-offset-4">
      <BrandMark />
      <span className="min-w-0 leading-tight">
        <span
          className={cn(
            'block text-[15px] font-semibold tracking-tight',
            tone === 'dark' ? 'text-white' : 'text-slate-900'
          )}
        >
          {SITE_NAME}
        </span>
        <span
          className={cn(
            'mt-0.5 block truncate text-[11px] font-medium',
            tone === 'dark' ? 'text-slate-400' : 'text-slate-500'
          )}
        >
          {SITE_TAGLINE}
        </span>
      </span>
    </Link>
  );
}
