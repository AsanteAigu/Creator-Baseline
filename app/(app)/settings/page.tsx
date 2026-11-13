import { Banner } from "@/components/banner";
import { SettingsForm, type SettingsValues } from "@/components/settings-form";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/services/settingsService";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const userId = await requirePageUser();
  const result = await withPageErrors(() => getSettings(userId));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { settings: s, canEdit } = result;

  const initial: SettingsValues = {
    weights: {
      watch_time: s.weights.watch_time ?? 0,
      sends: s.weights.sends ?? 0,
      saves: s.weights.saves ?? 0,
      likes: s.weights.likes ?? 0,
      comments: s.weights.comments ?? 0,
    },
    photoWeights: {
      sends: s.photoWeights.sends ?? 0,
      saves: s.photoWeights.saves ?? 0,
      likes: s.photoWeights.likes ?? 0,
      comments: s.photoWeights.comments ?? 0,
    },
    cap: s.cap,
    strongCutoff: s.strongCutoff,
    weakCutoff: s.weakCutoff,
    minAgeHours: s.minAgeHours,
    medianWindow: s.medianWindow,
    scheduleInterval: s.scheduleInterval,
    aiMonthlyBudgetUsd: s.aiMonthlyBudgetUsd,
  };

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Scoring settings</h1>
        <p className="text-sm text-muted-foreground">
          Changes apply from the next update. Past scores keep the settings they were calculated with. Last changed{" "}
          {formatDateTime(s.updatedAt)}.
        </p>
      </div>
      <SettingsForm initial={initial} canEdit={canEdit} />
    </>
  );
}
