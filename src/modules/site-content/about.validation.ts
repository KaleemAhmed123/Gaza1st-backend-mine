import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";
import { sanitizeRichText } from "./html-sanitizer";

/** Preset palettes built on the site's design tokens. Text colour is derived from the tone on the frontend. */
export const TONES = ["surface", "white", "primary", "primaryContainer", "inverseSurface", "tertiaryTint"] as const;
const toneSchema = z.enum(TONES).default("surface");

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1);
const richText = z.string().max(20_000).transform(sanitizeRichText);
const iconName = z.string().trim().regex(/^[a-z0-9_]+$/, "Use a Material Symbols icon name").max(40);
const linkHref = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith("/") || /^https?:\/\//i.test(v) || v.startsWith("mailto:"), "Use a site path or http(s)/mailto link");

const blockBase = { id: z.string().trim().min(1).max(40), tone: toneSchema };

const heroBlock = z.object({
  ...blockBase,
  type: z.literal("hero"),
  pill: text(60).optional(),
  headline: requiredText(160),
  subline: text(400).optional(),
  mediaId: objectIdSchema.nullish()
});

const richTextBlock = z.object({
  ...blockBase,
  type: z.literal("richText"),
  title: text(120).optional(),
  html: richText,
  mediaId: objectIdSchema.nullish(),
  mediaSide: z.enum(["start", "end"]).default("end")
});

const missionBlock = z.object({
  ...blockBase,
  type: z.literal("mission"),
  statement: requiredText(500),
  attribution: text(120).optional()
});

const noticeBlock = z.object({
  ...blockBase,
  type: z.literal("notice"),
  title: requiredText(120),
  html: richText
});

const coreAreasBlock = z.object({
  ...blockBase,
  type: z.literal("coreAreas"),
  title: requiredText(120),
  intro: text(400).optional(),
  items: z
    .array(
      z.object({
        icon: iconName,
        title: requiredText(80),
        body: requiredText(500),
        href: linkHref.optional()
      })
    )
    .length(4, "Exactly four core areas are required")
});

const impactBlock = z.object({
  ...blockBase,
  type: z.literal("impact"),
  title: requiredText(120),
  intro: text(400).optional()
});

const storiesPreviewBlock = z.object({
  ...blockBase,
  type: z.literal("storiesPreview"),
  title: requiredText(120),
  intro: text(400).optional(),
  limit: z.number().int().min(1).max(6).default(3)
});

const ctaBlock = z.object({
  ...blockBase,
  type: z.literal("cta"),
  title: requiredText(160),
  body: text(500).optional(),
  buttonLabel: requiredText(60),
  buttonHref: linkHref
});

export const aboutBlockSchema = z.discriminatedUnion("type", [
  heroBlock,
  richTextBlock,
  missionBlock,
  noticeBlock,
  coreAreasBlock,
  impactBlock,
  storiesPreviewBlock,
  ctaBlock
]);

export const aboutDocumentSchema = z.object({
  blocks: z
    .array(aboutBlockSchema)
    .max(30)
    .superRefine((blocks, ctx) => {
      const seen = new Set<string>();
      blocks.forEach((block, index) => {
        if (seen.has(block.id)) {
          ctx.addIssue({ code: "custom", path: [index, "id"], message: "Block ids must be unique" });
        }
        seen.add(block.id);
      });
    })
});

export type AboutBlock = z.infer<typeof aboutBlockSchema>;
export type AboutDocument = z.infer<typeof aboutDocumentSchema>;
