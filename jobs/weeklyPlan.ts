import { cron } from "inngest";
import { generateWeeklyPlanForCreator, weeklyPlanCreatorIds } from "@/lib/services/scheduleService";
import { inngest } from "./client";

/**
 * Monday 06:00 Europe/London. Each creator gets its own step, so one provider failure does
 * not stop the others and a retry only repeats the failed creator's plan.
 */
export const weeklyPlan = inngest.createFunction(
  {
    id: "weekly-plan",
    name: "Monday content plan",
    retries: 2,
    triggers: [cron("TZ=Europe/London 0 6 * * 1")],
  },
  async ({ step }) => {
    const creatorIds = await step.run("list-creators", () => weeklyPlanCreatorIds());
    const plans: { creatorId: string; outcome: string }[] = [];
    for (const creatorId of creatorIds) {
      const outcome = await step.run(`plan-${creatorId}`, () => generateWeeklyPlanForCreator(creatorId));
      plans.push({ creatorId, outcome });
    }
    return { plans };
  },
);
