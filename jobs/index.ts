import type { InngestFunction } from "inngest";
import { ingestCreatorJob } from "./ingestCreator";
import { purgeExpired } from "./purge";
import { scheduleTick } from "./scheduleTick";
import { weeklyPlan } from "./weeklyPlan";

/**
 * Every job, in one list. `serve()` in `app/api/inngest/route.ts` registers exactly this
 * array, so adding a schedule cannot silently miss the endpoint.
 */
export const functions: InngestFunction.Any[] = [scheduleTick, ingestCreatorJob, weeklyPlan, purgeExpired];
