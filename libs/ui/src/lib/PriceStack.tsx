import { formatBaht } from '@my-shop/domain';

interface Props {
  gross: number;
  net: number;
  /** Show "ฟรี" for a free line instead of ฿0. */
  free?: boolean;
  size?: 'md' | 'lg' | 'xl';
}

const big = { md: 'text-lg', lg: 'text-xl', xl: 'text-2xl' } as const;
const small = { md: 'text-sm', lg: 'text-base', xl: 'text-lg' } as const;

/** Final price, with the original struck through above it when discounted. */
export function PriceStack({ gross, net, free, size = 'lg' }: Props) {
  const discounted = net < gross;
  return (
    <span className="flex flex-col items-end leading-tight shrink-0">
      {discounted && <span className={`${small[size]} line-through opacity-60`}>{formatBaht(gross)}</span>}
      <span className={`${big[size]} font-semibold ${discounted || free ? 'text-primary' : ''}`}>{free || net === 0 ? 'ฟรี' : formatBaht(net)}</span>
    </span>
  );
}
