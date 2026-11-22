/** Display formatting (BUILD_PROMPT §10): en-GB, percentages 1 dp, scores 2 dp, Europe/London. */

const TZ = "Europe/London";

const numberFmt = new Intl.NumberFormat("en-GB");
const compactFmt = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
const percentFmt = new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const shortDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export const formatScore = (n: number) => n.toFixed(2);
export const formatNumber = (n: number) => numberFmt.format(n);
export const formatCompact = (n: number) => compactFmt.format(n);
export const formatPercent = (fraction: number) => percentFmt.format(fraction);
export const formatDate = (d: Date) => dateFmt.format(d);
export const formatShortDate = (d: Date) => shortDateFmt.format(d);
export const formatTime = (d: Date) => timeFmt.format(d);
export const formatDateTime = (d: Date) => `${shortDateFmt.format(d)}, ${timeFmt.format(d)}`;
/** For calendar dates already expressed in London (YYYY-MM-DD). */
export const formatIsoDay = (iso: string) => weekdayFmt.format(new Date(`${iso}T12:00:00Z`));
/** "Times usual" for an r value, e.g. 2.1x. */
export const formatRatio = (r: number) => `${r.toFixed(1)}x`;

export const SIGNAL_LABELS: Record<string, string> = {
  watch_time: "Watch time",
  sends: "Sends",
  saves: "Saves",
  likes: "Likes",
  comments: "Comments",
};

export const FORMAT_LABELS: Record<string, string> = {
  reel: "Reel",
  image: "Photo",
  carousel: "Carousel",
};

export const FORMAT_PLURAL: Record<string, string> = {
  reel: "reels",
  image: "photos",
  carousel: "carousels",
};
/** Signed change for deltas, e.g. "+12.4%" or "−3.0%". */
export const formatSignedPercent = (fraction: number) => `${fraction > 0 ? "+" : fraction < 0 ? "−" : ""}${percentFmt.format(Math.abs(fraction))}`;
/** Signed score difference, e.g. "+0.08". */
export const formatSignedScore = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;
const isoShortFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
/** "10 Nov" for a London calendar date (YYYY-MM-DD). */
export const formatIsoShortDate = (iso: string) => isoShortFmt.format(new Date(`${iso}T12:00:00Z`));
