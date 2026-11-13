import { cron } from "inngest";
import { purgeExpired as runPurgeExpired } from "@/lib/services/deletionService";
import { inngest } from "./client";

/**
 * Daily housekeeping: fail runs stranded by a crashed invocation and finish deletion
 * requests that did not complete. It is not a retention policy - the client asked to keep
 * past reports (R7, D-035).
 */
export const purgeExpired = inngest.createFunction(
  {
    id: "purge-expired",
    name: "Daily housekeeping",
    triggers: [cron("TZ=Europe/London 30 3 * * *")],
  },
  async ({ step }) => step.run("purge", () => runPurgeExpired()),
);
