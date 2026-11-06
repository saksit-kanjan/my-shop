interface Props {
  onKey: (key: string) => void;
  keys?: string[];
  size?: 'md' | 'lg';
}

const DEFAULT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ล้าง', '0', 'ลบ'];

/** Touch keypad. Physical number keys work too where the page wires them up. */
export function Keypad({ onKey, keys = DEFAULT_KEYS, size = 'lg' }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)} className={`btn btn-ghost bg-base-200 ${size === 'lg' ? 'h-16 text-2xl' : 'h-14 text-xl'} font-medium lift`}>
          {k}
        </button>
      ))}
    </div>
  );
}

/** Apply a keypad key to a digit string. */
export function applyKey(value: string, key: string, maxLen: number): string {
  if (key === 'ล้าง' || key === 'C') return '';
  if (key === 'ลบ') return value.slice(0, -1);
  if (!/^\d+$/.test(key)) return value;
  const next = (value === '0' ? '' : value) + key;
  return next.length > maxLen ? value : next;
}
