import { Sparkles } from "lucide-react";

/** Required on every AI-generated section (BUILD_PROMPT §10, requirements R13). */
export function AiDisclaimer() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles aria-hidden className="size-3.5" />
      AI-generated advice. Review before you act on it.
    </p>
  );
}
