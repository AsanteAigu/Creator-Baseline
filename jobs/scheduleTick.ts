import { cron } from "inngest";
import { dueCreatorIds } from "@/lib/services/scheduleService";
import { creatorSyncRequested, inngest } from "./client";

/**
 * Hourly tick. The due check lives in `scheduleService` so the schedule window is testable
 * without a database; this function only fans out one event per due creator (D-032).
 */
export const scheduleTick = inngest.createFunction(
  {
    id: "schedule-tick",
    name: "Hourly schedule tick",
    triggers: [cron("0 * * * *")],
  },
  async ({ step }) => {
    const creatorIds = await step.run("find-due-creators", () => dueCreatorIds());
    for (const creatorId of creatorIds) {
      await step.sendEvent(`request-sync-${creatorId}`, creatorSyncRequested.create({ creatorId }));
    }
    return { due: creatorIds.length };
  },
);
