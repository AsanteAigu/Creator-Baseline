import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

/** The single error shape for every API response (BUILD_PROMPT §9). */
export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export function errorResponse(err: unknown): NextResponse<ErrorBody> {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join(".") || "body"] = issue.message;
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Some values need fixing.", fields } },
      { status: 422 },
    );
  }
  // Never expose raw errors (they can carry SQL or another tenant's identifiers).
  console.error(`[api] unexpected ${err instanceof Error ? err.name : "error"}`);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return user.id;
}

/** Wraps a handler so every thrown error becomes the standard error shape. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "The request body must be JSON.");
  }
}

export const uuidParam = z.uuid({ message: "Not a valid id." });
