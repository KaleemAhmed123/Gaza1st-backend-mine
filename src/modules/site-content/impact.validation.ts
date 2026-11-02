import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";

export const createImpactStatSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.number().int().min(0).max(1_000_000_000),
  suffix: z.string().trim().max(5).nullish(),
  icon: z.string().trim().regex(/^[a-z0-9_]+$/, "Use a Material Symbols icon name").max(40).nullish(),
  asOf: z.coerce.date().nullish(),
  isActive: z.boolean().default(true)
});

export const updateImpactStatSchema = createImpactStatSchema.partial();

export const reorderImpactStatsSchema = z.object({
  ids: z.array(objectIdSchema).min(1).max(50)
});
