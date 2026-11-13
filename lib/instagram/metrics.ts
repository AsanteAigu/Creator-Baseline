import type { PostFormat } from "@/lib/scoring";
import type { RawMedia } from "./types";

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
