import { Inngest, eventType } from "inngest";
import { z } from "zod";

/**
 * Background jobs (BUILD_PROMPT §8). One hourly tick fans out typed events instead of a
 * dynamic cron per creator (D-032). Inngest reads INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY
 * from the environment; it is inert locally when they are unset.
 */
export const inngest = new Inngest({ id: "creator-baseline" });

export const creatorSyncRequested = eventType("creator/sync.requested", {
  schema: z.object({ creatorId: z.uuid() }),
});
