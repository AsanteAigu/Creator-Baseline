/** Wording for each analytics range on the account page. */
export interface RangeCopy {
  tab: string;
  text: string;
  comparison: string;
}

const RANGE_COPY: Record<number, RangeCopy> = {
  28: { tab: "28 days", text: "last 28 days", comparison: "vs previous 28 days" },
  90: { tab: "90 days", text: "last 90 days", comparison: "vs previous 90 days" },
  365: { tab: "12 months", text: "last 12 months", comparison: "vs previous 12 months" },
};

export function rangeCopy(days: number): RangeCopy {
  return RANGE_COPY[days] ?? { tab: `${days} days`, text: `last ${days} days`, comparison: `vs previous ${days} days` };
}

/** The breakdown charts use at least 90 days so a quiet month still has enough posts to compare. */
export function breakdownText(days: number): string {
  return days === 365 ? "last 12 months" : `last ${days} days`;
}
