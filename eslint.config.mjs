import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Enforces the one-way import direction in docs/ARCHITECTURE.md:
// app -> services -> repositories -> db. lib/scoring is pure.
// Later blocks replace (not merge) rule options, so the catch-all comes first.
const layerRules = [
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/ai/client.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@anthropic-ai/sdk"], message: "Only lib/ai/client.ts imports the Anthropic SDK." }] },
      ],
    },
  },
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/lib/repositories", "@/lib/repositories/*"], message: "UI and routes call services, never repositories." },
            { group: ["postgres", "@/lib/db", "@/lib/db/*"], message: "Only repositories touch Postgres." },
            { group: ["@anthropic-ai/sdk"], message: "Only lib/ai/client.ts imports the Anthropic SDK." },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/scoring/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "^(?!\.{1,2}/).*", message: "lib/scoring is pure: relative type imports only." },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["postgres", "@supabase/*", "@/lib/db", "@/lib/db/*"], message: "Services call repositories; no SQL here." },
            { group: ["next/*", "next"], message: "Services know nothing about HTTP." },
            { group: ["@anthropic-ai/sdk"], message: "Only lib/ai/client.ts imports the Anthropic SDK." },
          ],
        },
      ],
    },
  },
];

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  ...layerRules,
];

export default config;
