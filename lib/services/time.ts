/** Calendar helpers pinned to Europe/London, where the client works (BUILD_PROMPT §10). */

const LONDON = "Europe/London";
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of the given instant as seen in London. */
export function londonIsoDate(d: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Monday of the London week containing `now`. */
export function weekStartLondon(now: Date): string {
  const today = londonIsoDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysIso(today, -((weekday + 6) % 7));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i));
}

/** Start of the hour: the unit an ingestion run is idempotent over. */
export function runWindowStart(now: Date): Date {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

const INTERVAL_HOURS: Record<string, number> = {
  "1 hour": 1,
  "3 hours": 3,
  "6 hours": 6,
  "12 hours": 12,
  "24 hours": 24,
};

export function intervalHours(scheduleInterval: string): number {
  return INTERVAL_HOURS[scheduleInterval] ?? 6;
}
