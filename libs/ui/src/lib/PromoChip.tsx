import type { ReactNode } from 'react';

interface Props {
  /** `got`: already in the bill (green). `near`: customer can still get it (orange, dashed). */
  state: 'got' | 'near';
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const text = { sm: 'text-sm', md: 'text-base', lg: 'text-lg' } as const;

/** The one place that encodes promotion status as colour, so every screen agrees. */
export function PromoChip({ state, children, size = 'md' }: Props) {
  if (state === 'got') {
    return <span className={`inline-flex w-fit rounded-full bg-secondary text-secondary-content px-3 py-0.5 font-medium ${text[size]}`}>✓ {children}</span>;
  }
  return <span className={`inline-flex w-fit rounded-full border-2 border-dashed border-warning text-warning px-3 py-0 font-semibold ${text[size]}`}>+ {children}</span>;
}
