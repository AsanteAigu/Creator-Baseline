import type { PlanOutput, ReportOutput, ThemesOutput } from "@/lib/ai/schemas";
import type { PlanInput } from "@/prompts/plan/system";
import type { ReportInput, ReportPostInput } from "@/prompts/report/system";

/**
 * Deterministic stand-ins for the three AI calls when AI_PROVIDER=mock. They are built from
 * the same input the real model receives, so the demo reads sensibly for each creator.
 * Nothing here is shown as fact: the UI labels every AI section as AI-generated advice.
 */

const SIGNAL_NAMES: Record<string, string> = {
  watch_time: "watch time",
  sends: "sends",
  saves: "saves",
  likes: "likes",
  comments: "comments",
};

function extremeSignal(post: ReportPostInput, pick: "max" | "min"): [string, number] {
  const entries = Object.entries(post.rValues);
  entries.sort((a, b) => (pick === "max" ? b[1] - a[1] : a[1] - b[1]));
  return entries[0] ?? ["likes", 1];
}

function describe(post: ReportPostInput): string {
  return `the ${post.format} from ${post.postedOn} ("${post.caption.slice(0, 50)}")`;
}

const THEME_RULES: { label: string; sentiment: ThemesOutput["themes"][number]["sentiment"]; test: RegExp; paraphrase: string }[] = [
  { label: "Requests for new versions", sentiment: "neutral", test: /\b(can you|could you|please|version|do a)\b/i, paraphrase: "Viewers are asking for variations and follow-up content." },
  { label: "Questions about products", sentiment: "neutral", test: /\b(where|what brand|which|link|how much)\b/i, paraphrase: "People want to know where items come from and what they cost." },
  { label: "Praise and thanks", sentiment: "positive", test: /\b(love|helpful|perfect|unreal|clearly|so good|seconds|follow you)\b/i, paraphrase: "Followers say the content is useful and they enjoy it." },
  { label: "Tried it themselves", sentiment: "positive", test: /\b(made this|did this|tried it|tonight|today)\b/i, paraphrase: "Some viewers report trying the idea straight away." },
  { label: "Criticism and concerns", sentiment: "negative", test: /\b(not a fan|too|hurt|not for me|tiny|sorry)\b/i, paraphrase: "A minority found something off-putting or unsuitable for them." },
];

export function mockThemes(comments: readonly string[]): ThemesOutput {
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  const counts = new Map<string, number>();
  for (const c of comments) {
    const rule = THEME_RULES.find((r) => r.test.test(c));
    sentiment[rule?.sentiment ?? "neutral"] += 1;
    if (rule) counts.set(rule.label, (counts.get(rule.label) ?? 0) + 1);
  }
  const themes = THEME_RULES.filter((r) => (counts.get(r.label) ?? 0) > 0)
    .map((r) => ({
      label: r.label,
      count: counts.get(r.label) ?? 0,
      sentiment: r.sentiment,
      example_paraphrase: r.paraphrase,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  return { sentiment, themes };
}

export function mockReport(input: ReportInput): ReportOutput {
  const working = input.top.slice(0, 3).map((p) => {
    const [signal, r] = extremeSignal(p, "max");
    return {
      point: `${capitalise(p.format)}s like ${describe(p)} are outperforming on ${SIGNAL_NAMES[signal] ?? signal}.`,
      evidence: `Scored ${p.score.toFixed(2)} with ${SIGNAL_NAMES[signal] ?? signal} at ${r.toFixed(1)}x usual.`,
    };
  });
  const notWorking = input.bottom.slice(0, 3).map((p) => {
    const [signal, r] = extremeSignal(p, "min");
    return {
      point: `${capitalise(describe(p))} fell short on ${SIGNAL_NAMES[signal] ?? signal}.`,
      evidence: `Scored ${p.score.toFixed(2)} with ${SIGNAL_NAMES[signal] ?? signal} at ${r.toFixed(1)}x usual.`,
    };
  });
  const best = input.top[0];
  return {
    headline: best
      ? `${capitalise(best.format)}s are leading this period; the best scored ${best.score.toFixed(2)}.`
      : "Not enough scored posts yet to call a trend.",
    what_working: working.length > 0 ? working : [{ point: "Too early to say.", evidence: "No posts have been scored yet." }],
    what_not_working:
      notWorking.length > 0 ? notWorking : [{ point: "Too early to say.", evidence: "No posts have been scored yet." }],
  };
}

export function mockPlan(input: PlanInput): PlanOutput {
  const sources = input.top.length > 0 ? input.top : input.bottom;
  const theme = input.themes[0];
  const ideas = input.weekDates.map((date, i) => {
    const src = sources[i % Math.max(1, sources.length)];
    const [signal, r] = src ? extremeSignal(src, "max") : ["likes", 1];
    const useTheme = theme !== undefined && i % 3 === 2;
    return {
      title: useTheme ? `Answer: ${theme.label.toLowerCase()}` : `New take: ${src?.caption.slice(0, 60) ?? "audience favourite"}`,
      format: (src?.format ?? "reel") as PlanOutput["ideas"][number]["format"],
      hook: useTheme ? "You asked, so here it is." : "Here is the version you saved last time, made faster.",
      reason: useTheme
        ? `Comments keep raising this (${theme.count} in the latest sample).`
        : `Builds on a post whose ${SIGNAL_NAMES[signal] ?? signal} ran at ${r.toFixed(1)}x usual.`,
      data_ref: useTheme ? `theme: ${theme.label}` : src ? `${src.format}, ${src.postedOn}, score ${src.score.toFixed(2)}` : "no scored posts yet",
      suggested_date: date,
    };
  });
  return {
    summary: `Build the week around the formats scoring above usual for @${input.username}, and answer what the audience keeps asking for in comments.`,
    ideas,
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
