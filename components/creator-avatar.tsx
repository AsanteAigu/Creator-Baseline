import { cn } from "@/lib/utils";

// Soft tints so accounts are easy to tell apart at a glance. Decorative only: the name is always shown beside it.
const TINTS = [
  "bg-[#e3edfb] text-[#1d4f8f]",
  "bg-[#e6f2ea] text-[#25613a]",
  "bg-[#efe7f9] text-[#5b3a8c]",
  "bg-[#f6ebe2] text-[#7a4a25]",
  "bg-[#e4f1f4] text-[#1f5c69]",
  "bg-[#f7e6ea] text-[#8a2f45]",
] as const;

function tintFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length] ?? TINTS[0];
}

/** Initials only: no third-party image requests from the dashboard. */
export function CreatorAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/[\s._@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold ring-2 ring-card",
        tintFor(name),
        className,
      )}
    >
      {initials}
    </span>
  );
}
