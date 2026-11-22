import { serve } from "inngest/next";
import { functions } from "@/jobs";
import { inngest } from "@/jobs/client";

/**
 * Inngest's endpoint (SPECIFICATION §8). `serve` authenticates every request with
 * INNGEST_SIGNING_KEY, so this route needs no session of its own.
 */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
