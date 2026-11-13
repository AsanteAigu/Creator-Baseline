import { ExternalLink } from "lucide-react";
import { LabelBadge } from "@/components/label-badge";
import { FORMAT_LABELS, SIGNAL_LABELS, formatCompact, formatRatio, formatScore, formatShortDate } from "@/lib/format";
import type { Label } from "@/lib/scoring";

export interface PostRowData {
  id: string;
  format: string;
  permalink: string | null;
  postedAt: Date;
  captionExcerpt: string | null;
  reach: number | null;
  score: number | null;
  label: Label | null;
  rValues: Record<string, number>;
}

/** Names the signal that most explains the score: the highest r for top posts, lowest for bottom. */
function standout(r: Record<string, number>, pick: "max" | "min"): string | null {
  const entries = Object.entries(r);
  if (entries.length === 0) return null;
  entries.sort((a, b) => (pick === "max" ? b[1] - a[1] : a[1] - b[1]));
  const [signal, value] = entries[0] ?? [];
  if (signal === undefined || value === undefined) return null;
  return `${SIGNAL_LABELS[signal] ?? signal} ${formatRatio(value)} usual`;
}

export function PostRow({ post, emphasis }: { post: PostRowData; emphasis: "max" | "min" }) {
  const note = standout(post.rValues, emphasis);
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="w-12 shrink-0 text-right">
        <p className="text-lg font-semibold tabular-nums">{post.score === null ? "–" : formatScore(post.score)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm">{post.captionExcerpt ?? "No caption"}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {post.label ? <LabelBadge label={post.label} /> : null}
          <span>
            {FORMAT_LABELS[post.format] ?? post.format} · {formatShortDate(post.postedAt)}
          </span>
          {post.reach !== null ? <span>{formatCompact(post.reach)} reached</span> : null}
          {note ? <span>{note}</span> : null}
        </div>
      </div>
      {post.permalink ? (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          aria-label="Open on Instagram"
        >
          <ExternalLink aria-hidden className="size-4" />
        </a>
      ) : null}
    </li>
  );
}
