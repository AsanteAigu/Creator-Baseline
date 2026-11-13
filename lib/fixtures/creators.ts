/**
 * Deterministic fixture data for three demo creators. The seed script uses it now and the
 * mock Instagram source will read from it in Phase 2, so both always agree.
 *
 * Same `now` in, same data out: a seeded PRNG drives every number. Post timestamps are
 * relative to `now` so the "3 hours old" post stays 3 hours old whenever you reseed.
 */

export type PostFormat = "reel" | "image" | "carousel";

export interface FixtureCreator {
  key: string;
  igUserId: string;
  username: string;
  displayName: string;
  niche: string;
  /** Typical reach of an average post. */
  baseReach: number;
  /** Fraction of posts per format; reels take the remainder. */
  imageShare: number;
  carouselShare: number;
  captions: readonly string[];
}

export interface FixtureMetrics {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  avgWatchTimeMs: number | null;
  videoViews: number | null;
}

/** Why a post exists in the fixture set, so tests can find the edge cases by name. */
export type FixtureTag = "viral" | "zero_comments" | "fresh_3h";

export interface FixturePost {
  igMediaId: string;
  format: PostFormat;
  permalink: string;
  postedAt: Date;
  captionExcerpt: string;
  durationMs: number | null;
  metrics: FixtureMetrics;
  tags: FixtureTag[];
}

export const POSTS_PER_CREATOR = 40;

export const FIXTURE_CREATORS: readonly FixtureCreator[] = [
  {
    key: "maya",
    igUserId: "17841400000000101",
    username: "maya.cooks.uk",
    displayName: "Maya Okafor",
    niche: "food",
    baseReach: 420_000,
    imageShare: 0.27,
    carouselShare: 0.25,
    captions: [
      "15-minute chilli oil noodles that taste like a takeaway",
      "Batch-cook Sunday: five lunches for under £12",
      "The only roast potato method you need this winter",
      "Jollof rice, my mum's way — no shortcuts",
      "Three sauces that make any weeknight pasta better",
      "Supermarket own-brand vs name brand: blind taste test",
      "Air fryer salmon with honey, soy and garlic",
      "What I eat in a week as a recipe developer",
    ],
  },
  {
    key: "theo",
    igUserId: "17841400000000202",
    username: "theo.trains",
    displayName: "Theo Marsh",
    niche: "fitness",
    baseReach: 1_150_000,
    imageShare: 0.24,
    carouselShare: 0.2,
    captions: [
      "Stop doing crunches. Do this instead",
      "Full-body dumbbell workout, 30 minutes, no bench",
      "How I got my first pull-up at 34",
      "Protein on a budget: a week of meals for £25",
      "Five mobility drills for desk-job hips",
      "Running form fixes that stopped my knee pain",
      "Gym anxiety is normal. Here is how I handle it",
      "Progressive overload explained in 60 seconds",
    ],
  },
  {
    key: "ivy",
    igUserId: "17841400000000303",
    username: "ivy.interiors",
    displayName: "Ivy Chen",
    niche: "interiors",
    baseReach: 260_000,
    // Kept low on purpose: under 5 images, so the "baseline building" empty state is demoable.
    imageShare: 0.08,
    carouselShare: 0.4,
    captions: [
      "Rented flat refresh with no drilling and no deposit risk",
      "Before and after: a 6 m² box room becomes an office",
      "Five charity-shop finds and how I styled them",
      "Paint colours that make a north-facing room feel warmer",
      "Small hallway storage that does not look like storage",
      "The £40 lighting swap that changed my living room",
      "Styling a bookshelf in three steps",
      "Victorian terrace kitchen: one year on",
    ],
  },
] as const;

const HOUR_MS = 60 * 60 * 1000;

/** mulberry32: tiny, fast, good enough for fixtures, and identical on every platform. */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normal(rng: () => number): number {
  // Box-Muller; 1 - rng() avoids log(0).
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Multiplicative noise centred on 1, so most posts land near the creator's norm. */
function jitter(rng: () => number, sigma: number): number {
  return Math.exp(normal(rng) * sigma - (sigma * sigma) / 2);
}

function pickFormat(rng: () => number, creator: FixtureCreator): PostFormat {
  const r = rng();
  if (r < creator.imageShare) return "image";
  if (r < creator.imageShare + creator.carouselShare) return "carousel";
  return "reel";
}

/** Typical engagement rates per reached account, by format. */
const BASE_RATES: Record<PostFormat, { likes: number; comments: number; shares: number; saves: number }> = {
  reel: { likes: 0.048, comments: 0.0032, shares: 0.011, saves: 0.012 },
  carousel: { likes: 0.055, comments: 0.0041, shares: 0.007, saves: 0.019 },
  image: { likes: 0.061, comments: 0.0036, shares: 0.004, saves: 0.008 },
};

export function generateCreatorPosts(creator: FixtureCreator, now: Date): FixturePost[] {
  const rng = createRng(seedFrom(creator.key));
  const posts: FixturePost[] = [];

  // Index 0 is the newest post. Indices chosen for the edge cases are fixed per creator.
  const viralIndex = 7;
  const zeroCommentsIndex = 12;

  let ageHours = 3;
  for (let i = 0; i < POSTS_PER_CREATOR; i += 1) {
    const tags: FixtureTag[] = [];
    if (i === 0) tags.push("fresh_3h");
    if (i === viralIndex) tags.push("viral");
    if (i === zeroCommentsIndex) tags.push("zero_comments");

    // The viral post is always a reel; that is what goes viral on Instagram.
    const format: PostFormat = i === viralIndex ? "reel" : pickFormat(rng, creator);
    const postedAt = new Date(now.getTime() - ageHours * HOUR_MS);

    const durationMs = format === "reel" ? Math.round(15_000 + rng() * 75_000) : null;

    const reachMultiplier = i === viralIndex ? 6.5 : 1;
    // A 3-hour-old post has only seen a fraction of its eventual audience.
    const maturity = i === 0 ? 0.18 : 1;
    const reach = Math.round(creator.baseReach * jitter(rng, 0.35) * reachMultiplier * maturity);

    const rates = BASE_RATES[format];
    const rateBoost = i === viralIndex ? 2.2 : 1;
    const likes = Math.round(reach * rates.likes * jitter(rng, 0.25) * rateBoost);
    const comments =
      i === zeroCommentsIndex ? 0 : Math.round(reach * rates.comments * jitter(rng, 0.4) * rateBoost);
    const shares = Math.round(reach * rates.shares * jitter(rng, 0.45) * rateBoost);
    const saves = Math.round(reach * rates.saves * jitter(rng, 0.4) * rateBoost);

    let avgWatchTimeMs: number | null = null;
    let videoViews: number | null = null;
    if (format === "reel" && durationMs !== null) {
      const watchFraction = Math.min(0.95, 0.42 * jitter(rng, 0.25) * (i === viralIndex ? 1.5 : 1));
      avgWatchTimeMs = Math.round(durationMs * watchFraction);
      videoViews = Math.round(reach * (1.15 + rng() * 0.35));
    }

    const caption = creator.captions[i % creator.captions.length] ?? creator.niche;
    const igMediaId = `${creator.igUserId}_${String(POSTS_PER_CREATOR - i).padStart(3, "0")}`;

    posts.push({
      igMediaId,
      format,
      permalink: `https://www.instagram.com/${format === "reel" ? "reel" : "p"}/FIXTURE${creator.key.toUpperCase()}${POSTS_PER_CREATOR - i}/`,
      postedAt,
      captionExcerpt: caption.slice(0, 300),
      durationMs,
      metrics: { reach, likes, comments, shares, saves, avgWatchTimeMs, videoViews },
      tags,
    });

    // Roughly one post every 1-3 days.
    ageHours += 24 + Math.round(rng() * 48);
  }

  return posts;
}
