import { Inbox } from "lucide-react";

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card">
        <Inbox aria-hidden className="size-[18px]" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}
