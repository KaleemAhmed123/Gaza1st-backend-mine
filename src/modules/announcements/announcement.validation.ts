import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";

export const listAnnouncementsQuerySchema = z.object({
  category: z.string().min(1).optional(),
  universityId: objectIdSchema.optional(),
  regionId: objectIdSchema.optional(),
  isPublic: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true"))
});

export const listPublicAnnouncementsQuerySchema = z.object({
  category: z.string().min(1).optional(),
  universityId: objectIdSchema.optional(),
  regionId: objectIdSchema.optional(),
  search: z.string().optional(),
  degreeLevel: z.string().optional(),
  fundingType: z.string().optional(),
  subject: z.string().optional(),
  scholarshipStatus: z.string().optional(),
  deadlineStatus: z.enum(["open", "closing_soon", "future", "rolling", "closed"]).optional()
});

export const listAdminAnnouncementsQuerySchema = z.object({
  category: z.string().min(1).optional(),
  universityId: objectIdSchema.optional(),
  regionId: objectIdSchema.optional(),
  isPublic: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  isPublished: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true"))
});

export const createAnnouncementSchema = z.object({
  title: z.string().min(3).max(180),
  body: z.string().min(3).max(500000),
  category: z.string().min(1).optional(),
  isPublished: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  regionId: objectIdSchema.nullable().optional(),
  universityId: objectIdSchema.nullable().optional(),
  showApplyButton: z.boolean().optional(),
  applyLink: z.string().max(2000).nullable().optional(),

  // Scholarship specifications (PRD aligned)
  degreeLevel: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  fundingType: z.string().nullable().optional(),
  scholarshipStatus: z.string().nullable().optional(),
  deadline: z.string().nullable().optional().transform(v => (v ? new Date(v) : null)),
  isRollingDeadline: z.boolean().optional(),
  provider: z.string().max(200).nullable().optional(),
  officialUrl: z.string().max(2000).nullable().optional(),
  duration: z.string().max(100).nullable().optional(),
  scholarshipDetails: z.record(z.unknown()).nullable().optional()
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial();

export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;
export type ListPublicAnnouncementsQuery = z.infer<typeof listPublicAnnouncementsQuerySchema>;
export type ListAdminAnnouncementsQuery = z.infer<typeof listAdminAnnouncementsQuerySchema>;
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
