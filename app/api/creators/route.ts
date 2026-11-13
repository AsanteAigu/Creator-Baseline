import { NextResponse } from "next/server";
import { handle, requireUserId } from "@/lib/http";
import { listCreatorCards } from "@/lib/services/creatorService";

export const GET = handle(async () => {
  const userId = await requireUserId();
  const { cards } = await listCreatorCards(userId);
  // Three accounts in v1; the list is still wrapped so pagination can be added without a break.
  return NextResponse.json({ items: cards, nextCursor: null });
});
