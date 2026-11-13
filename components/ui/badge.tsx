import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground",
        good: "border-[#0ca30c]/40 bg-[#0ca30c]/10 text-[#006300]",
        bad: "border-[#d03b3b]/40 bg-[#d03b3b]/10 text-[#9f1f1f]",
        warn: "border-[#fab219]/60 bg-[#fab219]/15 text-[#7a5200]",
        info: "border-border bg-background text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
