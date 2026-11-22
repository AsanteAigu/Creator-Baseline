/** Product mark: a rising line crossing a baseline. Drawn inline so it needs no asset request. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <line
        x1="7"
        x2="25"
        y1="19"
        y2="19"
        stroke="white"
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeDasharray="2 2.5"
      />
      <path
        d="M7 22 L12.5 16.5 L16.5 19.5 L25 10"
        fill="none"
        stroke="white"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25" cy="10" r="2.25" fill="#7fb4f0" />
    </svg>
  );
}
