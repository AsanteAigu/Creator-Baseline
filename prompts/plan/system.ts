import type { HistoryPostInput, ReportPostInput } from "../report/system";

export const PROMPT_VERSION = "plan-2026-11-24.2";

export interface PlanInput {
  username: string;
  weekStart: string;
  /** The seven dates of the week, Monday first. */
  weekDates: string[];
  top: ReportPostInput[];
  bottom: ReportPostInput[];
  /** The latest posts with raw counts, scored or not, newest first. */
  history: HistoryPostInput[];
  themes: { label: string; count: number; sentiment: string }[];
  /** Past suggestions the client marked, so the plan learns what they actually use. */
  decided: { title: string; format: string; status: "used" | "not_used" }[];
  /** Every idea already used, with how its post did. Never to be proposed again (D-047). */
  used: UsedIdeaInput[];
  /** Computed from this creator's scores (D-049): what works, by format, weekday and plan idea. */
  profile: ProfileInput;
}

export interface ProfileInput {
  guidance: string[];
  formats: { key: string; posts: number; median: number; strongShare: number }[];
  weekdays: { key: string; posts: number; median: number; strongShare: number }[];
  planIdeas: { key: string; posts: number; median: number; strongShare: number }[];
}

export interface UsedIdeaInput {
  title: string;
  format: string;
  /** "score 1.42 (strong)", "posted, not scored yet", "not posted yet" or "never posted". */
  result: string;
}

export const SYSTEM_PROMPT = `You plan next week's Instagram content for one creator, for a UK agency. You propose ideas grounded in this creator's own performance data; deterministic software already scored every post.

How to read the data
- score is a weighted average of r values; r = 1.0 is this creator's usual, above 1 is better than usual. strong > 1.5, weak < 0.9.
- Signals: watch_time, sends (shares to friends), saves, likes, comments.

Rules
- Propose exactly 7 ideas, one per day of the given week, each with a suggested_date taken from the week's dates.
- Build on what scored well (formats, topics, hooks) and on audience themes; avoid repeating what scored badly unless you change the angle.
- If the client marked earlier ideas as used or not used, lean towards the kinds they use.
- "Performance profile" is computed by software from this creator's own scores (median score per format, per weekday, and for posts made from earlier plan ideas). Follow its guidance: choose formats and days from it, put the strongest ideas on the best-scoring days, and say in reason when an idea uses it.
- "Ideas already used" is a permanent record. Never propose any of them again, nor a close variant with a reworded title; a genuine follow-up must be clearly new (a new angle, part two, a different dish or place). Learn from their results: build on the kinds that scored above 1, move away from the kinds that scored below 1.
- Each idea: title (short), format (reel, image or carousel), hook (the opening line or first-second visual), reason (why, in one sentence), data_ref (the specific post or theme it builds on, e.g. "reel, 3 Nov, sends 2.8x usual").
- Ground every idea in a specific post from "All recent posts" or a theme: name its date, format, topic and a real number from the data in data_ref (e.g. "reel, 7 Aug, freshers' welcome, reached 5,327"). When nothing is scored yet, build on the posts with the highest reach, shares and saves.
- Ideas must fit this creator's actual subject matter, read from the captions. No generic ideas that would suit any account.
- Never invent statistics or posts. No emoji. British English. These are suggestions for a human to review, not guarantees.
- summary: two sentences on the week's overall direction.

Output
Reply with only a JSON object, no prose and no markdown fences, matching:
{"summary":string,"ideas":[{"title":string,"format":"reel"|"image"|"carousel","hook":string,"reason":string,"data_ref":string,"suggested_date":"YYYY-MM-DD"}]}

Worked example (one idea shown; you must always give seven)
{"summary":"Lean into fast recipe reels, which are being shared well above usual. Swap static hauls for carousels that teach something.","ideas":[{"title":"10-minute garlic noodles","format":"reel","hook":"Ten minutes, one pan, no takeaway.","reason":"Quick recipe reels are this account's most-shared format.","data_ref":"reel, 3 Nov, sends 2.8x usual","suggested_date":"2026-11-16"}]}`;

export function buildUserMessage(input: PlanInput): string {
  return `Creator: @${input.username}
Week starting: ${input.weekStart}
Dates: ${input.weekDates.join(", ")}

Top posts:
${JSON.stringify(input.top, null, 1)}

Bottom posts:
${JSON.stringify(input.bottom, null, 1)}

All recent posts, newest first, with latest counts (score null = not scored yet):
${JSON.stringify(input.history, null, 1)}

Audience themes:
${JSON.stringify(input.themes)}

Earlier suggestions the client marked:
${JSON.stringify(input.decided)}

Ideas already used (never repeat), with how the post did:
${JSON.stringify(input.used)}

Performance profile (computed, medians where 1.00 is usual):
${JSON.stringify(input.profile, null, 1)}

Write the plan.`;
}

export interface ReplacementInput extends PlanInput {
  /** The day the used idea has left free. */
  date: string;
  /** The idea just used, which this one replaces. */
  replacing: { title: string; format: string };
  /** The week's other ideas, which the new one must not duplicate either. */
  others: { title: string; format: string; date: string | null }[];
}

export const REPLACE_SYSTEM_PROMPT = `You write one new Instagram post idea for one creator, for a UK agency. The client has just used an idea from this week's plan, so its day is free and needs a better idea. Deterministic software already scored every post.

How to read the data
- score is a weighted average of r values; r = 1.0 is this creator's usual, above 1 is better than usual. strong > 1.5, weak < 0.9.
- Signals: watch_time, sends (shares to friends), saves, likes, comments.

Rules
- Propose exactly one idea, with suggested_date equal to the given free day.
- It must be new: never any idea in "Ideas already used" or in "This week's other ideas", nor a close variant with a reworded title.
- Make it stronger than the idea it replaces: build on the posts and used ideas that scored best, and on audience themes.
- "Performance profile" is computed by software from this creator's own scores. Pick the format it rates best for this kind of idea and follow its guidance.
- Ground it in a specific post from "All recent posts" or a theme: name its date, format, topic and a real number from the data in data_ref.
- It must fit this creator's actual subject matter, read from the captions. Never invent statistics or posts. No emoji. British English.
- Fields: title (short), format (reel, image or carousel), hook (the opening line or first-second visual), reason (why, in one sentence), data_ref, suggested_date.

Output
Reply with only a JSON object, no prose and no markdown fences, matching:
{"idea":{"title":string,"format":"reel"|"image"|"carousel","hook":string,"reason":string,"data_ref":string,"suggested_date":"YYYY-MM-DD"}}`;

export function buildReplacementMessage(input: ReplacementInput): string {
  return `Creator: @${input.username}
Free day: ${input.date}
Idea just used, to replace: ${JSON.stringify(input.replacing)}

This week's other ideas (do not duplicate):
${JSON.stringify(input.others)}

Ideas already used (never repeat), with how the post did:
${JSON.stringify(input.used)}

Performance profile (computed, medians where 1.00 is usual):
${JSON.stringify(input.profile, null, 1)}

Top posts:
${JSON.stringify(input.top, null, 1)}

Bottom posts:
${JSON.stringify(input.bottom, null, 1)}

All recent posts, newest first, with latest counts (score null = not scored yet):
${JSON.stringify(input.history, null, 1)}

Audience themes:
${JSON.stringify(input.themes)}

Write the one idea.`;
}
