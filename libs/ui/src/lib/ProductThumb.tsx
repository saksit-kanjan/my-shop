interface Props {
  imageKey?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizes = { sm: 'w-9 h-9', md: 'w-12 h-12', lg: 'w-16 h-16', xl: 'w-24 h-24' } as const;

/** Product picture. Uses the demo sprite until products have uploaded photos. */
export function ProductThumb({ imageKey, size = 'md', className = '' }: Props) {
  return <span aria-hidden="true" className={`pimg ${imageKey ? 'p-' + imageKey : 'p-none'} block rounded-lg shrink-0 ${sizes[size]} ${className}`} />;
}

export function GiftThumb({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-9 h-9' : 'w-10 h-10';
  return (
    <span aria-hidden="true" className={`${box} rounded-lg shrink-0 grid place-items-center bg-secondary text-secondary-content`}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <path d="M12 8v13M5 12v9h14v-9M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
      </svg>
    </span>
  );
}
