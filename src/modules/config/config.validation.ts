import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";

export const listOptionsQuerySchema = z.object({
  groupKey: z.string().min(1)
});

export const listUniversitiesQuerySchema = z.object({
  regionId: objectIdSchema.optional(),
  search: z.string().min(1).optional()
});

export const createConfigOptionSchema = z.object({
  groupKey: z.string().min(1),
  value: z.string().min(1),
  labelEn: z.string().min(1),
  labelAr: z.string().min(1).optional(),
  sortOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const updateConfigOptionSchema = createConfigOptionSchema.partial();

export const createRegionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean().optional()
});

export const updateRegionSchema = createRegionSchema.partial();

export const createUniversitySchema = z.object({
  regionId: objectIdSchema,
  name: z.string().min(1),
  city: z.string().min(1).optional(),
  logoUrl: z.string().optional(),
  isLondon: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export const updateUniversitySchema = createUniversitySchema.partial();
