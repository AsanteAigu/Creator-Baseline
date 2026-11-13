import { z } from "zod";

/** Every model output passes one of these before anything reads it (BUILD_PROMPT §2). */

const sentimentLabel = z.enum(["positive", "neutral", "negative"]);

export const themesOutputSchema = z.object({
  sentiment: z.object({
    positive: z.number().int().min(0),
    neutral: z.number().int().min(0),
    negative: z.number().int().min(0),
  }),
  themes: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        count: z.number().int().min(1),
        sentiment: sentimentLabel,
        example_paraphrase: z.string().min(1).max(200),
      }),
    )
    .max(8),
});
export type ThemesOutput = z.infer<typeof themesOutputSchema>;

const reportPoint = z.object({
  point: z.string().min(1).max(240),
  evidence: z.string().min(1).max(240),
});

export const reportOutputSchema = z.object({
  headline: z.string().min(1).max(160),
  what_working: z.array(reportPoint).min(1).max(5),
  what_not_working: z.array(reportPoint).min(1).max(5),
});
export type ReportOutput = z.infer<typeof reportOutputSchema>;

export const planOutputSchema = z.object({
  summary: z.string().min(1).max(400),
  ideas: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        format: z.enum(["reel", "image", "carousel"]),
        hook: z.string().min(1).max(200),
        reason: z.string().min(1).max(300),
        data_ref: z.string().min(1).max(160),
        suggested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
      }),
    )
    .length(7),
});
export type PlanOutput = z.infer<typeof planOutputSchema>;
