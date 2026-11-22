import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex min-h-11 w-full rounded-lg border border-border bg-card px-3.5 text-base shadow-[inset_0_1px_1px_rgb(16_24_40/0.03)] transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 hover:border-foreground/20 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/12 disabled:opacity-50 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-foreground/90", className)} {...props} />;
}
