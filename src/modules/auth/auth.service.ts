import bcrypt from "bcryptjs";
import crypto from "crypto";
import { AuthTokenType, Prisma, RoleCode, VolunteerStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { recordAuditLog } from "../../shared/audit";
import { sendEmailBestEffort } from "../../shared/email";
import { emailTemplates } from "../../shared/email-templates";
import { ApiError } from "../../shared/http";
import type {
  forgotPasswordSchema,
  loginSchema,
  registerStudentSchema,
  registerVolunteerSchema,
  resetPasswordSchema,
  sendVerificationEmailSchema,
  verifyEmailSchema
} from "./auth.validation";
import type { z } from "zod";

type RegisterStudentInput = z.infer<typeof registerStudentSchema>;
type RegisterVolunteerInput = z.infer<typeof registerVolunteerSchema>;
type LoginInput = z.infer<typeof loginSchema>;
type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
type SendVerificationEmailInput = z.infer<typeof sendVerificationEmailSchema>;
type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

const passwordSaltRounds = 12;
const passwordResetExpiryMs = 60 * 60 * 1000;
const emailVerificationExpiryMs = 24 * 60 * 60 * 1000;

const authUserBaseSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  roles: true,
  accountStatus: true,
  emailVerifiedAt: true,
  deletedAt: true
} satisfies Prisma.UserSelect;

const studentAuthProfileSelect = {
  id: true,
  profileStatus: true,
  reviewNotes: true,
  hasOfferSelfReported: true,
  hasVerifiedOffer: true,
  communityGuidelinesApproved: true
} satisfies Prisma.StudentProfileSelect;

const volunteerAuthProfileSelect = {
  id: true,
  volunteerStatus: true,
  universityAffiliation: true,
  preferredRegionId: true,
  reviewNotes: true
} satisfies Prisma.VolunteerProfileSelect;

const regionalAdminAuthProfileSelect = {
  id: true,
  regionId: true,
  status: true,
  region: {
    select: {
      code: true,
      name: true
    }
  }
} satisfies Prisma.RegionalAdminProfileSelect;

const loginUserSelect = {
  ...authUserBaseSelect,
  passwordHash: true
} satisfies Prisma.UserSelect;

type AuthUserRecord = Prisma.UserGetPayload<{ select: typeof authUserBaseSelect }>;
type LoginUserRecord = Prisma.UserGetPayload<{ select: typeof loginUserSelect }>;

function createRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildFrontendUrl(path: string, token: string) {
  const url = new URL(path, env.FRONTEND_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

async function createAuthToken(input: {
  userId: string;
  type: AuthTokenType;
  expiresInMs: number;
}) {
  const token = createRawToken();
  const tokenHash = hashToken(token);

  await prisma.$transaction([
    prisma.authToken.updateMany({
      where: {
        userId: input.userId,
        type: input.type,
        expiresAt: { gt: new Date() }
      },
      data: { usedAt: new Date() }
    }),
    prisma.authToken.create({
      data: {
        userId: input.userId,
        type: input.type,
        tokenHash,
        expiresAt: new Date(Date.now() + input.expiresInMs),
        usedAt: null
      }
    })
  ]);

  return token;
}

async function consumeAuthToken(input: { token: string; type: AuthTokenType }) {
  const authToken = await prisma.authToken.findFirst({
    where: {
      tokenHash: hashToken(input.token),
      type: input.type
    },
    include: { user: true }
  });

  if (!authToken || authToken.usedAt || authToken.expiresAt <= new Date()) {
    throw new ApiError(400, "Invalid or expired token");
  }

  if (authToken.user.deletedAt || authToken.user.accountStatus === "disabled") {
    throw new ApiError(400, "Invalid or expired token");
  }

  return authToken;
}

function assertValidAuthUser(user: AuthUserRecord | LoginUserRecord | null) {
  if (!user || user.deletedAt || user.accountStatus === "disabled") {
    throw new ApiError(401, "Invalid user account");
  }

  return user;
}

async function toAuthUser(user: AuthUserRecord | LoginUserRecord | null) {
  const validUser = assertValidAuthUser(user);
  const [studentProfile, volunteerProfile, regionalAdminProfile] = await Promise.all([
    validUser.roles.includes(RoleCode.student)
      ? prisma.studentProfile.findUnique({
          where: { userId: validUser.id },
          select: studentAuthProfileSelect
        })
      : Promise.resolve(null),
    validUser.roles.includes(RoleCode.mentor)
      ? prisma.volunteerProfile.findUnique({
          where: { userId: validUser.id },
          select: volunteerAuthProfileSelect
        })
      : Promise.resolve(null),
    validUser.roles.includes(RoleCode.regional_admin)
      ? prisma.regionalAdminProfile.findUnique({
          where: { userId: validUser.id },
          select: regionalAdminAuthProfileSelect
        })
      : Promise.resolve(null)
  ]);

  let volunteerProfileWithRegion = null;
  if (volunteerProfile) {
    let region = null;
    if (volunteerProfile.preferredRegionId) {
      region = await prisma.region.findUnique({
        where: { id: volunteerProfile.preferredRegionId },
        select: { id: true, code: true, name: true }
      });
    }
    volunteerProfileWithRegion = {
      ...volunteerProfile,
      preferredRegion: region
    };
  }

  return {
    id: validUser.id,
    email: validUser.email,
    fullName: validUser.fullName,
    phone: validUser.phone,
    roles: validUser.roles,
    regionId: regionalAdminProfile?.regionId,
    accountStatus: validUser.accountStatus,
    emailVerifiedAt: validUser.emailVerifiedAt,
    studentProfile,
    volunteerProfile: volunteerProfileWithRegion,
    regionalAdminProfile
  };
}

async function buildAuthUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: authUserBaseSelect
  });

  return toAuthUser(user);
}

export async function registerStudent(input: RegisterStudentInput) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone,
      roles: [RoleCode.student],
      deletedAt: null,
      studentProfile: {
        create: {
          hasOfferSelfReported: input.hasOfferSelfReported,
          deletedAt: null
        }
      }
    }
  });

  void sendEmailBestEffort({
    to: [user.email],
    subject: "Welcome to Gaza40",
    text: `Hello ${user.fullName}, welcome to Gaza40!`,
    html: emailTemplates.welcome(user.fullName, 'student')
  });

  // Send the real email-verification link (screen at /verify-email tells the user to click it).
  void sendVerificationEmail(user.id, {});

  return buildAuthUser(user.id);
}

export async function registerVolunteer(input: RegisterVolunteerInput) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw new ApiError(409, "An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone,
      ...(input.dateOfBirth ? { dateOfBirth: new Date(input.dateOfBirth) } : {}),
      roles: [RoleCode.mentor],
      deletedAt: null,
      volunteerProfile: {
        create: {
          universityAffiliation: input.universityAffiliation,
          preferredRegionId: input.preferredRegionId,
          deletedAt: null
        }
      }
    }
  });

  void sendEmailBestEffort({
    to: [user.email],
    subject: "Welcome to Gaza40",
    text: `Hello ${user.fullName}, welcome to Gaza40!`,
    html: emailTemplates.welcome(user.fullName, 'mentor')
  });

  // Send the real email-verification link (screen at /verify-email tells the user to click it).
  void sendVerificationEmail(user.id, {});

  // Notify Master Admins about the new volunteer signup
  prisma.user.findMany({
    where: { roles: { has: RoleCode.master_admin }, accountStatus: 'active', deletedAt: null },
    select: { email: true }
  }).then(masterAdmins => {
    const adminEmails = masterAdmins.map(a => a.email);
    if (adminEmails.length > 0) {
      sendEmailBestEffort({
        to: adminEmails,
        subject: "New Volunteer Signup - Gaza40",
        text: `A new volunteer (${user.fullName}, ${user.email}) has signed up.`,
        html: emailTemplates.adminNewVolunteer(user.fullName, user.email)
      });
    }
  }).catch(console.error);

  return buildAuthUser(user.id);
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: loginUserSelect
  });
  if (!user || user.deletedAt) {
    throw new ApiError(401, "Invalid email or password");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new ApiError(401, "Invalid email or password");
  }

  void prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: { id: true }
  }).catch((error) => {
    console.error(
      `Failed to update last login timestamp: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  });

  return toAuthUser(user);
}

export async function getCurrentUser(userId: string) {
  return buildAuthUser(userId);
}

export async function forgotPassword(input: ForgotPasswordInput) {
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null, accountStatus: "active" },
    select: { id: true, email: true, fullName: true }
  });

  if (!user) {
    return { message: "If the email exists, a reset link has been sent." };
  }

  const token = await createAuthToken({
    userId: user.id,
    type: AuthTokenType.password_reset,
    expiresInMs: passwordResetExpiryMs
  });

  sendEmailBestEffort({
    to: [user.email],
    subject: "Reset your Gaza40 password",
    text: `Hi ${user.fullName},\n\nUse this link to reset your password:\n${buildFrontendUrl("/reset-password", token)}\n\nThis link expires in 1 hour.`,
    html: emailTemplates.forgotPassword(user.fullName, buildFrontendUrl("/reset-password", token))
  });

  return { message: "If the email exists, a reset link has been sent." };
}

export async function resetPassword(input: ResetPasswordInput) {
  const authToken = await consumeAuthToken({
    token: input.token,
    type: AuthTokenType.password_reset
  });
  const passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: authToken.userId },
      data: { passwordHash }
    }),
    prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() }
    })
  ]);

  await recordAuditLog({
    actorUserId: authToken.userId,
    action: "password_reset_completed",
    entityType: "user",
    entityId: authToken.userId
  });

  return { reset: true };
}

export async function sendVerificationEmail(
  userId: string,
  input: SendVerificationEmailInput
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, accountStatus: "active" },
    select: { id: true, email: true, fullName: true, emailVerifiedAt: true }
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (user.emailVerifiedAt) {
    return { alreadyVerified: true };
  }

  const token = await createAuthToken({
    userId: user.id,
    type: AuthTokenType.email_verification,
    expiresInMs: emailVerificationExpiryMs
  });
  const redirectPath = input.redirectPath ?? "/verify-email";

  sendEmailBestEffort({
    to: [user.email],
    subject: "Verify your Gaza40 email",
    text: `Hi ${user.fullName},\n\nUse this link to verify your email:\n${buildFrontendUrl(redirectPath, token)}\n\nThis link expires in 24 hours.`,
    html: emailTemplates.notification(
      user.fullName, 
      "Email Verification", 
      "Please verify your email address to unlock full access to the Gaza40 platform. This link will expire in 24 hours.", 
      buildFrontendUrl(redirectPath, token), 
      "Verify Email"
    )
  });

  return { sent: true };
}

export async function verifyEmail(input: VerifyEmailInput) {
  const authToken = await consumeAuthToken({
    token: input.token,
    type: AuthTokenType.email_verification
  });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: authToken.userId },
      data: { emailVerifiedAt: new Date() }
    }),
    prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() }
    })
  ]);

  await recordAuditLog({
    actorUserId: authToken.userId,
    action: "email_verified",
    entityType: "user",
    entityId: authToken.userId
  });

  return { verified: true };
}

export async function updateMyVolunteerProfile(userId: string, universityAffiliation: string) {
  const profile = await prisma.volunteerProfile.findUnique({
    where: { userId }
  });

  if (!profile) {
    throw new ApiError(404, "Volunteer profile not found");
  }

  await prisma.volunteerProfile.update({
    where: { userId },
    data: {
      universityAffiliation,
      volunteerStatus: VolunteerStatus.pending,
      reviewNotes: null,
      reviewedAt: null,
      reviewedBy: null
    }
  });

  return buildAuthUser(userId);
}
