import type { PostFormat } from "@/lib/scoring";
import { InstagramError, type RawInsights, type RawMedia } from "./types";

/** The single place Instagram's media classification becomes one of our three formats. */
export function toPostFormat(media: Pick<RawMedia, "mediaType" | "mediaProductType">): PostFormat {
  if (media.mediaProductType === "REELS" || media.mediaType === "VIDEO") return "reel";
  if (media.mediaType === "CAROUSEL_ALBUM") return "carousel";
  return "image";
}

/** Stories expire before they are old enough to score (DECISIONS.md D-012). */
export function isScorableMedia(media: Pick<RawMedia, "mediaProductType">): boolean {
  return media.mediaProductType !== "STORY" && media.mediaProductType !== "AD";
}

export const CAPTION_EXCERPT_MAX = 300;

export function captionExcerpt(caption: string | null): string | null {
  if (caption === null) return null;
  const trimmed = caption.trim();
  return trimmed.length <= CAPTION_EXCERPT_MAX ? trimmed : trimmed.slice(0, CAPTION_EXCERPT_MAX);
}

/**
 * Graph API media insight names, checked against the Instagram Platform reference on
 * 13 Nov 2026 (Graph API v27.0). `impressions` and `plays` are deprecated, so they are not used.
 * Watch time is only offered for REELS; FEED videos therefore score without it.
 */
const FEED_METRICS = {
  reach: "reach",
  likes: "likes",
  comments: "comments",
  saves: "saved",
  shares: "shares",
} as const;

const REELS_METRICS = {
  ...FEED_METRICS,
  avgWatchTimeMs: "ig_reels_avg_watch_time",
  videoViews: "views",
} as const;

export function insightMetricsFor(media: Pick<RawMedia, "mediaProductType">): string[] {
  return Object.values(media.mediaProductType === "REELS" ? REELS_METRICS : FEED_METRICS);
}

export interface GraphInsightEntry {
  name: string;
  values?: { value?: unknown }[];
  total_value?: { value?: unknown };
}

function readValue(entry: GraphInsightEntry): number | null {
  const v = entry.values?.[0]?.value ?? entry.total_value?.value;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Maps a `/{media-id}/insights` response to our fields. Throws when a metric we asked for is
 * missing: storing 0 would silently pull the creator's baseline down (§6).
 */
export function mapInsights(media: Pick<RawMedia, "id" | "mediaProductType">, data: readonly GraphInsightEntry[]): RawInsights {
  const byName = new Map(data.map((e) => [e.name, readValue(e)]));
  const get = (name: string): number => {
    const v = byName.get(name);
    if (v === undefined || v === null) {
      throw new InstagramError(`Instagram did not return the "${name}" metric for a post.`, "PERMANENT", false);
    }
    return v;
  };
  const isReel = media.mediaProductType === "REELS";
  return {
    reach: get(FEED_METRICS.reach),
    likes: get(FEED_METRICS.likes),
    comments: get(FEED_METRICS.comments),
    saves: get(FEED_METRICS.saves),
    shares: get(FEED_METRICS.shares),
    avgWatchTimeMs: isReel ? Math.round(get(REELS_METRICS.avgWatchTimeMs)) : null,
    videoViews: isReel ? get(REELS_METRICS.videoViews) : null,
  };
}
