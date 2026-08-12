import { z } from "zod";
import { objectIdSchema } from "../../shared/validation";

function minAgeDate(years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD format")
  .refine((val) => {
    const dob = new Date(val);
    return !isNaN(dob.getTime()) && dob <= minAgeDate(16);
  }, "You must be at least 16 years old to register")
  .optional();

export const registerStudentSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().min(1),
  hasOfferSelfReported: z.boolean().default(false),
});

export const registerVolunteerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  phone: z.string().optional(),
  preferredRegionId: objectIdSchema.optional(),
  universityAffiliation: z.string().optional(),
  dateOfBirth: dateOfBirthSchema,
});


export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1)
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase()
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8)
});

export const sendVerificationEmailSchema = z.object({
  redirectPath: z.string().startsWith("/").optional()
});

export const verifyEmailSchema = z.object({
  token: z.string().min(32)
});
