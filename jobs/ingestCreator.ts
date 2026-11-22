import { ingestCreator } from "@/lib/services/runService";
import { creatorSyncRequested, inngest } from "./client";

/**
 * The ingestion pipeline as a durable step. `ingestCreator` already records Instagram and
 * AI failures on the run row and returns normally, so Inngest retries only unexpected
 * throws (a database outage, not a rejected token).
 */
export const ingestCreatorJob = inngest.createFunction(
  {
    id: "ingest-creator",
    name: "Ingest creator",
    retries: 3,
    concurrency: { key: "event.data.creatorId", limit: 1 },
    triggers: [creatorSyncRequested],
  },
  async ({ event, step }) => step.run("ingest", () => ingestCreator(event.data.creatorId, { trigger: "schedule" })),
);
