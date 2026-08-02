import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";

export const offerInputSchema = z.object({
  regionId: objectIdSchema.optional(),
  universityId: objectIdSchema.optional(),
  universityCountry: z.string().min(1).optional(),
  universityName: z.string().min(1),
  courseName: z.string().min(1),
  courseField: z.string().min(1),
  courseLevel: z.string().min(1),
  durationYears: z.coerce.number().positive(),
  programmeStartDate: z.coerce.date(),
  offerType: z.string().min(1),
  conditions: z.string().min(1).optional(),
  tuitionFeePerYear: z.coerce.number().nonnegative(),
  courseFeeSourceUrl: z.string().url().optional(),
  hasScholarship: z.boolean().default(false),
  scholarshipName: z.string().min(1).nullable().optional(),
  scholarshipAmount: z.coerce.number().nonnegative().nullable().optional(),
  scholarshipInterval: z.enum(['annual', 'one_time']).optional().default('annual'),
  scholarshipCoversLivingCost: z.boolean().default(false),
  privateFundingAmount: z.coerce.number().nonnegative().default(0),
  privateFundingSource: z.string().min(1).optional(),
  privateFundingInterval: z.enum(["annual", "one_time"]).default("annual"),
  livingCostLocationKey: z.string().min(1).optional(),
  livingCostForVisa: z.coerce.number().nonnegative().optional(),
  boardingFees: z.coerce.number().nonnegative().optional()
}).refine((input) => input.universityId || input.regionId || input.universityCountry, {
  message: "universityId, regionId, or universityCountry is required",
  path: ["universityCountry"]
});

export const reviewOfferSchema = z.object({
  status: z.enum(["approved", "changes_requested", "rejected"]),
  notes: z.string().min(1).optional()
});

export const listAdminOffersQuerySchema = z.object({
  regionId: objectIdSchema.optional(),
  status: z.enum(["draft", "under_review", "approved", "changes_requested", "rejected", "removed"]).optional(),
  offerType: z.string().min(1).optional(),
  universityName: z.string().min(1).optional(),
  courseField: z.string().min(1).optional(),
  courseLevel: z.string().min(1).optional(),
  fundingType: z.enum(["fully_funded", "partial_funding", "private_funding", "no_funding"]).optional(),
  hasScholarship: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  search: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});

export const assignOfferMentorSchema = z.object({
  mentorId: objectIdSchema
});

export type AssignOfferMentorInput = z.infer<typeof assignOfferMentorSchema>;
