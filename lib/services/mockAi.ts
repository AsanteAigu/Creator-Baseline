import type { PlanOutput, PlanReplacementOutput, ReportOutput, ThemesOutput } from "@/lib/ai/schemas";
import type { PlanInput, ReplacementInput } from "@/prompts/plan/system";
import type { ReportInput, ReportPostInput } from "@/prompts/report/system";
import { isRepeat } from "./planTracking";

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

const FORMAT_WORD: Record<string, string> = { reel: "reel", image: "photo", carousel: "carousel" };
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** "1 Nov" from an ISO calendar date. */
function day(iso: string): string {
  return dayFmt.format(new Date(`${iso}T12:00:00Z`));
}

function formatWord(format: string): string {
  return FORMAT_WORD[format] ?? format;
}

function describe(post: ReportPostInput): string {
  return `the ${day(post.postedOn)} ${formatWord(post.format)} ("${post.caption.slice(0, 50)}")`;
}

const THEME_RULES: {
  label: string;
  sentiment: ThemesOutput["themes"][number]["sentiment"];
  test: RegExp;
  paraphrase: string;
}[] = [
  {
    label: "Requests for new versions",
    sentiment: "neutral",
    test: /\b(can you|could you|please|version|do a)\b/i,
    paraphrase: "Viewers are asking for variations and follow-up content.",
  },
  {
    label: "Questions about products",
    sentiment: "neutral",
    test: /\b(where|what brand|which|link|how much)\b/i,
    paraphrase: "People want to know where items come from and what they cost.",
  },
  {
    label: "Praise and thanks",
    sentiment: "positive",
    test: /\b(love|helpful|perfect|unreal|clearly|so good|seconds|follow you)\b/i,
    paraphrase: "Followers say the content is useful and they enjoy it.",
  },
  {
    label: "Tried it themselves",
    sentiment: "positive",
    test: /\b(made this|did this|tried it|tonight|today)\b/i,
    paraphrase: "Some viewers report trying the idea straight away.",
  },
  {
    label: "Criticism and concerns",
    sentiment: "negative",
    test: /\b(not a fan|too|hurt|not for me|tiny|sorry)\b/i,
    paraphrase: "A minority found something off-putting or unsuitable for them.",
  },
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
      point: `${capitalise(describe(p))} beat this creator's usual on ${SIGNAL_NAMES[signal] ?? signal}.`,
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
      ? `${capitalise(formatWord(best.format))}s are leading this period; the best scored ${best.score.toFixed(2)}.`
      : "Not enough scored posts yet to call a trend.",
    what_working:
      working.length > 0 ? working : [{ point: "Too early to say.", evidence: "No posts have been scored yet." }],
    what_not_working:
      notWorking.length > 0 ? notWorking : [{ point: "Too early to say.", evidence: "No posts have been scored yet." }],
  };
}

const HOOKS = [
  "You saved this one more than anything else this month, so here is part two.",
  "Same idea, half the time.",
  "The question you keep asking, answered in 30 seconds.",
  "I tried the version you asked for. Here is what happened.",
  "Three mistakes I made the first time, so you don't.",
];

const SEQUELS = ["", ", part two", ", part three", ", part four", ", the next step"];

/** The first of base, "base, part two", ... that is not already taken, as a real model is told to. */
function freshTitle(base: string, taken: string[]): string | null {
  for (const suffix of SEQUELS) {
    const title = `${base}${suffix}`;
    if (!isRepeat(title, taken)) return title;
  }
  return null;
}

export function mockPlan(input: PlanInput): PlanOutput {
  const taken = input.used.map((u) => u.title);
  // Distinct source posts first, then audience themes, so ideas do not repeat.
  const sources = [...input.top, ...input.bottom.slice(0, 2)].filter(
    (p, i, all) => all.findIndex((q) => q.caption === p.caption) === i,
  );
  const themes = [...input.themes];
  let s = 0;
  let t = 0;
  const ideas = input.weekDates.map((date, i) => {
    const useTheme = themes.length > 0 && (i % 3 === 2 || s >= sources.length);
    if (useTheme) {
      const theme = themes[t % themes.length]!;
      t += 1;
      const base = `Answer the comments: ${theme.label.toLowerCase()}`;
      return {
        title: freshTitle(base, taken) ?? base,
        format: "reel" as const,
        hook: HOOKS[2]!,
        reason: `This came up ${theme.count} times in the latest comment sample.`,
        data_ref: `Audience theme: ${theme.label}`,
        suggested_date: date,
      };
    }
    const src = sources[s % Math.max(1, sources.length)];
    s += 1;
    const [signal, r] = src ? extremeSignal(src, "max") : ["likes", 1];
    const strong = src ? src.score >= 1 : true;
    const base = src
      ? `${strong ? "Follow-up to" : "New angle on"} "${src.caption.slice(0, 60)}"`
      : "Audience favourite, refreshed";
    return {
      title: freshTitle(base, taken) ?? base,
      format: (src?.format ?? "reel") as PlanOutput["ideas"][number]["format"],
      hook: HOOKS[i % HOOKS.length]!,
      reason: src
        ? strong
          ? `Its ${SIGNAL_NAMES[signal] ?? signal} ran at ${r.toFixed(1)}x usual; a follow-up builds on that.`
          : `The topic has potential but this ${formatWord(src.format)} underperformed; try a different opening.`
        : "No scored posts yet, so this starts from the creator's core topic.",
      data_ref: src
        ? `${capitalise(formatWord(src.format))}, ${day(src.postedOn)}, score ${src.score.toFixed(2)}`
        : "No scored posts yet",
      suggested_date: date,
    };
  });
  return {
    summary: `Build the week around what is scoring above usual for @${input.username}, and answer what the audience keeps asking for in comments.`,
    ideas,
  };
}

/** One idea for the free day: the best-scoring source whose follow-up is not taken yet. */
export function mockReplacement(input: ReplacementInput): PlanReplacementOutput {
  const taken = [...input.used.map((u) => u.title), ...input.others.map((o) => o.title), input.replacing.title];
  const sources = [...input.top].sort((a, b) => b.score - a.score);
  for (const src of sources) {
    const title = freshTitle(`Follow-up to "${src.caption.slice(0, 60)}"`, taken);
    if (!title) continue;
    const [signal, r] = extremeSignal(src, "max");
    return {
      idea: {
        title,
        format: src.format as PlanReplacementOutput["idea"]["format"],
        hook: HOOKS[0]!,
        reason: `Its ${SIGNAL_NAMES[signal] ?? signal} ran at ${r.toFixed(1)}x usual, the strongest signal not yet followed up.`,
        data_ref: `${capitalise(formatWord(src.format))}, ${day(src.postedOn)}, score ${src.score.toFixed(2)}`,
        suggested_date: input.date,
      },
    };
  }
  for (const theme of input.themes) {
    const title = freshTitle(`Answer the comments: ${theme.label.toLowerCase()}`, taken);
    if (!title) continue;
    return {
      idea: {
        title,
        format: "reel",
        hook: HOOKS[2]!,
        reason: `This came up ${theme.count} times in the latest comment sample.`,
        data_ref: `Audience theme: ${theme.label}`,
        suggested_date: input.date,
      },
    };
  }
  return {
    idea: {
      title: freshTitle("Behind the scenes of this week", taken) ?? `Behind the scenes, ${input.date}`,
      format: "reel",
      hook: HOOKS[1]!,
      reason: "Every scored post and theme already has a follow-up, so this shows the process instead.",
      data_ref: "No unused post or theme left this week",
      suggested_date: input.date,
    },
  };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
