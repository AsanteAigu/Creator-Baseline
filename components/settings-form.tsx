"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { SIGNAL_LABELS } from "@/lib/format";
import { callApi } from "./api-client";

export interface SettingsValues {
  weights: Record<"watch_time" | "sends" | "saves" | "likes" | "comments", number>;
  photoWeights: Record<"sends" | "saves" | "likes" | "comments", number>;
  cap: number;
  strongCutoff: number;
  weakCutoff: number;
  minAgeHours: number;
  medianWindow: number;
  scheduleInterval: string;
  aiMonthlyBudgetUsd: number;
}

const SCHEDULES = ["1 hour", "3 hours", "6 hours", "12 hours", "24 hours"];

function NumberField({
  id,
  label,
  value,
  step,
  onChange,
  disabled,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
  disabled: boolean;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-help` : undefined}
      />
      {error || hint ? (
        <p id={`${id}-help`} className={error ? "text-xs text-[#9f1f1f]" : "text-xs text-muted-foreground"}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

export function SettingsForm({ initial, canEdit }: { initial: SettingsValues; canEdit: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const disabled = !canEdit || saving;

  const reelSum = sum(values.weights);
  const photoSum = sum(values.photoWeights);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    setFields({});
    const result = await callApi("/api/settings/scoring", { method: "PATCH", body: JSON.stringify(values) });
    setSaving(false);
    if (result.ok) {
      setStatus({ ok: true, text: "Saved. The next update will use these settings." });
      router.refresh();
    } else {
      setStatus({ ok: false, text: result.message });
      setFields(result.fields ?? {});
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      {!canEdit ? (
        <p className="text-sm text-muted-foreground">You can view these settings. Only owners and admins can change them.</p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Reel weights</CardTitle>
          <CardDescription>
            How much each signal counts for reels. Must add up to 1. Currently {reelSum.toFixed(2)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(Object.keys(values.weights) as (keyof SettingsValues["weights"])[]).map((k) => (
            <NumberField
              key={k}
              id={`w-${k}`}
              label={SIGNAL_LABELS[k] ?? k}
              value={values.weights[k]}
              step={0.05}
              disabled={disabled}
              onChange={(v) => setValues((s) => ({ ...s, weights: { ...s.weights, [k]: v } }))}
            />
          ))}
          {fields.weights ? <p className="col-span-full text-xs text-[#9f1f1f]">{fields.weights}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photo and carousel weights</CardTitle>
          <CardDescription>No watch time for these formats. Must add up to 1. Currently {photoSum.toFixed(2)}.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(values.photoWeights) as (keyof SettingsValues["photoWeights"])[]).map((k) => (
            <NumberField
              key={k}
              id={`p-${k}`}
              label={SIGNAL_LABELS[k] ?? k}
              value={values.photoWeights[k]}
              step={0.05}
              disabled={disabled}
              onChange={(v) => setValues((s) => ({ ...s, photoWeights: { ...s.photoWeights, [k]: v } }))}
            />
          ))}
          {fields.photoWeights ? <p className="col-span-full text-xs text-[#9f1f1f]">{fields.photoWeights}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labels and limits</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField id="strong" label="Strong above" value={values.strongCutoff} step={0.05} disabled={disabled} error={fields.strongCutoff}
            onChange={(v) => setValues((s) => ({ ...s, strongCutoff: v }))} />
          <NumberField id="weak" label="Weak below" value={values.weakCutoff} step={0.05} disabled={disabled} error={fields.weakCutoff}
            onChange={(v) => setValues((s) => ({ ...s, weakCutoff: v }))} />
          <NumberField id="cap" label="Cap per signal" value={values.cap} step={0.5} disabled={disabled} error={fields.cap}
            hint="Stops one viral number from dominating." onChange={(v) => setValues((s) => ({ ...s, cap: v }))} />
          <NumberField id="age" label="Wait before scoring (hours)" value={values.minAgeHours} step={1} disabled={disabled}
            error={fields.minAgeHours} onChange={(v) => setValues((s) => ({ ...s, minAgeHours: v }))} />
          <NumberField id="window" label="Posts in the usual (median)" value={values.medianWindow} step={1} disabled={disabled}
            error={fields.medianWindow} onChange={(v) => setValues((s) => ({ ...s, medianWindow: v }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule and AI budget</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule">Update every</Label>
            <select
              id="schedule"
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-base shadow-[inset_0_1px_1px_rgb(16_24_40/0.03)] hover:border-foreground/20 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/12 sm:text-sm"
              value={values.scheduleInterval}
              disabled={disabled}
              onChange={(e) => setValues((s) => ({ ...s, scheduleInterval: e.target.value }))}
            >
              {SCHEDULES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <NumberField id="budget" label="Monthly AI budget (USD)" value={values.aiMonthlyBudgetUsd} step={5} disabled={disabled}
            error={fields.aiMonthlyBudgetUsd} hint="AI summaries pause when this is reached; scores keep updating."
            onChange={(v) => setValues((s) => ({ ...s, aiMonthlyBudgetUsd: v }))} />
        </CardContent>
      </Card>

      {canEdit ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" disabled={disabled}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          {status ? (
            <p role="status" className={status.ok ? "text-sm text-muted-foreground" : "text-sm text-[#9f1f1f]"}>
              {status.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
