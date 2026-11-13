/**
 * Data minimisation for comments (BUILD_PROMPT §7/§11): strip usernames and links, cap
 * length, dedupe, cap the sample. The result exists only in memory for one AI call.
 */

export const MAX_SAMPLED_COMMENTS = 300;
export const MAX_COMMENT_CHARS = 280;

const MENTION = /@[\w.]+/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const BARE_DOMAIN = /\b[\w-]+\.(?:com|co\.uk|uk|net|org|io|shop|store|link|ly|me)\b\S*/gi;

export function sanitiseComment(text: string): string {
  return text
    .replace(URL, "")
    .replace(BARE_DOMAIN, "")
    .replace(MENTION, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMENT_CHARS);
}

export function sampleComments(raw: Iterable<string>, max = MAX_SAMPLED_COMMENTS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of raw) {
    const clean = sanitiseComment(text);
    if (clean.length < 2) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}
