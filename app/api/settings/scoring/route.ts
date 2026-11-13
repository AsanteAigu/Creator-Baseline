import { NextResponse } from "next/server";
import { handle, readJson, requireUserId } from "@/lib/http";
import { getSettings, settingsPatchSchema, updateSettings } from "@/lib/services/settingsService";

export const GET = handle(async () => {
  const userId = await requireUserId();
  return NextResponse.json(await getSettings(userId));
});

export const PATCH = handle(async (req: Request) => {
  const userId = await requireUserId();
  const patch = settingsPatchSchema.parse(await readJson(req));
  return NextResponse.json(await updateSettings(userId, patch));
});
