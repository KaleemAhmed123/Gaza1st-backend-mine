import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";
import { sanitizeRichText } from "./html-sanitizer";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const createStorySchema = z.object({
  // First or preferred name only. There is intentionally no surname field.
  displayName: z.string().trim().min(1).max(60),
  country: z.string().trim().min(1).max(80),
  previousEducation: optionalText(200),
  university: optionalText(200),
  course: optionalText(200),
  scholarship: optionalText(200),
  journey: z.string().max(20_000).transform(sanitizeRichText),
  currentStatus: optionalText(200),
  quote: optionalText(500),
  photoMediaId: objectIdSchema.nullish(),
  sortOrder: z.number().int().min(0).max(10_000).default(0)
});

export const updateStorySchema = createStorySchema.partial();

export const setConsentSchema = z
  .object({
    status: z.enum(["none", "pending", "granted", "withdrawn"]),
    photoConsent: z.boolean().default(false),
    // Where the signed consent is held (never the document itself). Required to grant consent.
    note: z.string().trim().max(500).optional()
  })
  .superRefine((value, ctx) => {
    if (value.status === "granted" && !value.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Record where the signed consent is held" });
    }
  });

export const listPublicStoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
  page: z.coerce.number().int().min(1).default(1)
});
