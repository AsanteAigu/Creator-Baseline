import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-foreground/80 ring-border",
        good: "bg-[#0ca30c]/8 text-[#006300] ring-[#0ca30c]/25",
        bad: "bg-[#d03b3b]/8 text-[#9f1f1f] ring-[#d03b3b]/25",
        warn: "bg-[#fab219]/12 text-[#7a5200] ring-[#fab219]/40",
        info: "bg-card text-muted-foreground ring-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
