import { AlertTriangle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { Icon: Info, cls: "border-border/70 bg-card", icon: "bg-[#2a78d6]/10 text-[#1d5fae]" },
  warn: { Icon: AlertTriangle, cls: "border-[#fab219]/40 bg-[#fffaf0]", icon: "bg-[#fab219]/20 text-[#7a5200]" },
  error: { Icon: XCircle, cls: "border-[#d03b3b]/30 bg-[#fff7f7]", icon: "bg-[#d03b3b]/12 text-[#9f1f1f]" },
} as const;

export function Banner({
  tone,
  title,
  children,
  action,
}: {
  tone: keyof typeof TONES;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { Icon, cls, icon } = TONES[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex flex-col gap-3 rounded-xl border p-4 shadow-card sm:flex-row sm:items-center", cls)}
    >
      <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full", icon)}>
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <div className="flex-1 text-sm">
        <p className="font-medium">{title}</p>
        {children ? <div className="mt-0.5 text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
