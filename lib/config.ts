import { z } from "zod";

/** Working name. The only place the product name is written down. */
export const PRODUCT_NAME = "Creator Baseline";

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const optionalUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.url().optional())
  .optional();

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    DATABASE_URL: optionalString,

    AI_PROVIDER: z.enum(["anthropic", "mock"]).default("mock"),
    ANTHROPIC_API_KEY: optionalString,

    INSTAGRAM_SOURCE: z.enum(["graph", "mock"]).default("mock"),
    INSTAGRAM_APP_ID: optionalString,
    INSTAGRAM_APP_SECRET: optionalString,
    INSTAGRAM_REDIRECT_URI: optionalUrl,
    TOKEN_ENCRYPTION_KEY: optionalString,

    UPSTASH_REDIS_REST_URL: optionalUrl,
    UPSTASH_REDIS_REST_TOKEN: optionalString,

    INNGEST_EVENT_KEY: optionalString,
    INNGEST_SIGNING_KEY: optionalString,

    APP_BASE_URL: z.url().default("http://localhost:3000"),
  })
  .superRefine((env, ctx) => {
    const need = (key: keyof typeof env, reason: string) => {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `required ${reason}` });
      }
    };

    if (env.AI_PROVIDER === "anthropic") {
      need("ANTHROPIC_API_KEY", "when AI_PROVIDER=anthropic");
    }

    if (env.INSTAGRAM_SOURCE === "graph") {
      need("INSTAGRAM_APP_ID", "when INSTAGRAM_SOURCE=graph");
      need("INSTAGRAM_APP_SECRET", "when INSTAGRAM_SOURCE=graph");
      need("INSTAGRAM_REDIRECT_URI", "when INSTAGRAM_SOURCE=graph");
      need("TOKEN_ENCRYPTION_KEY", "when INSTAGRAM_SOURCE=graph");
    }

    // Validate shape whenever present, so a bad key fails at boot rather than at first encrypt.
    if (env.TOKEN_ENCRYPTION_KEY !== undefined) {
      const bytes = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
      if (bytes.length !== 32) {
        ctx.addIssue({
          code: "custom",
          path: ["TOKEN_ENCRYPTION_KEY"],
          message: "must be 32 bytes, base64-encoded",
        });
      }
    }

    if (env.NODE_ENV === "production") {
      need("NEXT_PUBLIC_SUPABASE_URL", "in production");
      need("NEXT_PUBLIC_SUPABASE_ANON_KEY", "in production");
      need("SUPABASE_SERVICE_ROLE_KEY", "in production");
      need("UPSTASH_REDIS_REST_URL", "in production");
      need("UPSTASH_REDIS_REST_TOKEN", "in production");
      need("INNGEST_EVENT_KEY", "in production");
      need("INNGEST_SIGNING_KEY", "in production");
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment:\n  ${issues.join("\n  ")}`);
    this.name = "EnvError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    // Report variable names only — never echo values, they may be secrets.
    throw new EnvError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/**
 * Parsed lazily so `next build` does not need runtime secrets.
 * Server code only: secrets are not inlined into the client bundle, so calling
 * this in the browser would see an empty environment.
 */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export interface FeatureFlags {
  mockInstagram: boolean;
  mockAi: boolean;
  rateLimiting: boolean;
}

export function featureFlags(env: ServerEnv = serverEnv()): FeatureFlags {
  return {
    mockInstagram: env.INSTAGRAM_SOURCE === "mock",
    mockAi: env.AI_PROVIDER === "mock",
    rateLimiting:
      env.UPSTASH_REDIS_REST_URL !== undefined && env.UPSTASH_REDIS_REST_TOKEN !== undefined,
  };
}
