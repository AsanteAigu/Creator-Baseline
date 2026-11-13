import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

export async function requirePageUser(): Promise<string> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user.id;
}

/**
 * Pages render known failures themselves: NOT_FOUND becomes the 404 page, FORBIDDEN a
 * readable message. Anything else falls through to the error boundary with its retry.
 */
export async function withPageErrors<T>(fn: () => Promise<T>): Promise<T | { message: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    if (err instanceof AppError && err.code === "FORBIDDEN") return { message: err.message };
    throw err;
  }
}
