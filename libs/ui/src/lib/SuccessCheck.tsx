export function SuccessCheck({ size = 96, label }: { size?: number; label: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="anim-pop" role="img" aria-label={label}>
      <circle cx="24" cy="24" r="22" fill="#e3f1ec" />
      <path className="check-draw" d="M14 24.5l7 7 13-14" fill="none" stroke="#0e6b58" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
