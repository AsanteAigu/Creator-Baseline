import { AlertTriangle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { Icon: Info, cls: "border-border bg-muted/60" },
  warn: { Icon: AlertTriangle, cls: "border-[#fab219]/60 bg-[#fab219]/10" },
  error: { Icon: XCircle, cls: "border-[#d03b3b]/40 bg-[#d03b3b]/5" },
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
  const { Icon, cls } = TONES[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center", cls)}>
      <Icon aria-hidden className="size-5 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="font-medium">{title}</p>
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
