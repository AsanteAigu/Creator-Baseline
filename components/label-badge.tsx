import { Clock, Hourglass, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Label } from "@/lib/scoring";

/** Colour is always paired with an icon and a word (SPECIFICATION §10 accessibility). */
const META: Record<Label, { text: string; tone: "good" | "bad" | "neutral" | "info"; Icon: typeof Minus }> = {
  strong: { text: "Strong", tone: "good", Icon: TrendingUp },
  normal: { text: "Normal", tone: "neutral", Icon: Minus },
  weak: { text: "Weak", tone: "bad", Icon: TrendingDown },
  too_early: { text: "Too early", tone: "info", Icon: Clock },
  baseline_building: { text: "Building baseline", tone: "info", Icon: Hourglass },
};

export function LabelBadge({ label }: { label: Label }) {
  const { text, tone, Icon } = META[label];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {text}
    </Badge>
  );
}

export const LABEL_TEXT: Record<Label, string> = Object.fromEntries(
  Object.entries(META).map(([k, v]) => [k, v.text]),
) as Record<Label, string>;
