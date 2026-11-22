import { Banner } from "@/components/banner";
import { PageHeader } from "@/components/page-header";
import { PeoplePanel } from "@/components/people-panel";
import { SettingsForm, type SettingsValues } from "@/components/settings-form";
import { requirePageUser, withPageErrors } from "@/app/(app)/page-helpers";
import { formatDateTime } from "@/lib/format";
import { listPeople } from "@/lib/services/memberService";
import { getSettings } from "@/lib/services/settingsService";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const userId = await requirePageUser();
  const result = await withPageErrors(() => getSettings(userId));
  if ("message" in result) return <Banner tone="warn" title={result.message} />;
  const { settings: s, canEdit } = result;
  // Owners and admins manage people; listPeople re-checks the role itself.
  const people = canEdit ? await withPageErrors(() => listPeople(userId)) : null;

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
      <PageHeader
        eyebrow="Settings"
        title="Scoring settings"
        description={`Changes apply from the next update. Past scores keep the settings they were calculated with. Last changed ${formatDateTime(s.updatedAt)}.`}
      />
      <SettingsForm initial={initial} canEdit={canEdit} />
      {people !== null && "message" in people ? <Banner tone="warn" title={people.message} /> : null}
      {people !== null && !("message" in people) ? (
        <PeoplePanel
          people={people.members.map((m) => ({
            userId: m.userId,
            email: m.email,
            role: m.role,
            creatorUsername: m.creatorUsername,
            isYou: m.userId === userId,
          }))}
          invites={people.invites.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.role,
            expiresLabel: formatDateTime(i.expiresAt),
          }))}
        />
      ) : null}
    </>
  );
}
