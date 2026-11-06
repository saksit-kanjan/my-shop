export function Steps({ items, current }: { items: string[]; current: number }) {
  return (
    <ul className="steps">
      {items.map((label, i) => (
        <li key={label} className={`step ${i <= current ? 'step-primary' : ''}`} aria-current={i === current ? 'step' : undefined}>
          {label}
        </li>
      ))}
    </ul>
  );
}
