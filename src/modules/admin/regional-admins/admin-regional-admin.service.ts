import bcrypt from "bcryptjs";
import { prisma } from "../../../db/prisma";
import { ApiError } from "../../../shared/http";
import { RoleCode, AccountStatus, RegionalAdminStatus } from "@prisma/client";
import { sendEmailBestEffort } from "../../../shared/email";
import { emailTemplates } from "../../../shared/email-templates";
import { io } from "../../chat/chat.socket";
import type { CreateRegionalAdminInput, UpdateRegionalAdminInput } from "./admin-regional-admin.validation";

const passwordSaltRounds = 12;

export async function createRegionalAdmin(input: CreateRegionalAdminInput, creatorUserId: string) {
  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (existingUser) {
    throw new ApiError(400, "Email is already registered");
  }

  const role = input.role || "regional_admin";

  if (role === "reviewer") {
    // Hash password
    const passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        plainPassword: input.password,
        fullName: input.fullName,
        accountStatus: AccountStatus.active,
        roles: [RoleCode.reviewer],
        emailVerifiedAt: new Date(), // admin-created accounts are trusted, no email verification needed
        deletedAt: null
      }
    });

    // Send the welcome email with credentials
    sendEmailBestEffort({
      to: [user.email],
      subject: "Welcome to Gaza40 - Profile Reviewer Account Created",
      text: `Hello ${user.fullName},\n\nYour Profile Reviewer account has been created.\nEmail: ${user.email}\nPassword: ${input.password}\n\nPlease log in and change your password.`,
      html: emailTemplates.regionalAdminInvite(user.fullName, user.email, input.password, "All Regions (Profile Reviewer)")
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt,
      role: "reviewer",
      status: "active",
      regionId: null,
      region: null,
      plainPassword: input.password
    };
  }

  if (!input.regionId) {
    throw new ApiError(400, "Region assignment is required for Regional Admins");
  }

  // Verify region exists
  const region = await prisma.region.findFirst({
    where: { id: input.regionId, isActive: true, deletedAt: null }
  });

  if (!region) {
    throw new ApiError(404, "Target region not found or inactive");
  }

  // Hash password
  const passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);

  // Create User and RegionalAdminProfile in transaction
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        accountStatus: AccountStatus.active,
        roles: [RoleCode.regional_admin],
        emailVerifiedAt: new Date(), // admin-created accounts are trusted, no email verification needed
        deletedAt: null
      }
    });

    const profile = await tx.regionalAdminProfile.create({
      data: {
        userId: user.id,
        regionId: region.id,
        assignedByUserId: creatorUserId,
        plainPassword: input.password,
        deletedAt: null
      },
      include: {
        region: true
      }
    });

    // Send the welcome email with credentials
    sendEmailBestEffort({
      to: [user.email],
      subject: "Welcome to Gaza40 - Regional Admin Account Created",
      text: `Hello ${user.fullName},\n\nYour Regional Admin account has been created.\nEmail: ${user.email}\nPassword: ${input.password}\nRegion: ${region.name}\n\nPlease log in and change your password.`,
      html: emailTemplates.regionalAdminInvite(user.fullName, user.email, input.password, region.name)
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt,
      role: "regional_admin",
      status: "active",
      regionId: profile.regionId,
      region: {
        id: profile.region.id,
        code: profile.region.code,
        name: profile.region.name
      },
      plainPassword: input.password
    };
  });
}

export async function resendRegionalAdminInvite(id: string) {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: {
      regionalAdminProfile: {
        include: { region: true }
      }
    }
  });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const isReviewer = user.roles.includes(RoleCode.reviewer);
  const plainPassword = isReviewer ? user.plainPassword : user.regionalAdminProfile?.plainPassword;
  const regionName = isReviewer ? "All Regions (Profile Reviewer)" : user.regionalAdminProfile?.region.name;

  sendEmailBestEffort({
    to: [user.email],
    subject: `Welcome to Gaza40 - ${isReviewer ? 'Profile Reviewer' : 'Regional Admin'} Account Credentials`,
    text: `Hello ${user.fullName},\n\nYour account details.\nEmail: ${user.email}\nPassword: ${plainPassword || 'Contact Master Admin'}\nRegion: ${regionName}\n\nPlease log in and change your password.`,
    html: emailTemplates.regionalAdminInvite(
      user.fullName,
      user.email,
      plainPassword || undefined,
      regionName || undefined
    )
  });

  return { message: "Invitation email sent successfully" };
}

export async function listRegionalAdmins() {
  const users = await prisma.user.findMany({
    where: {
      roles: { hasSome: [RoleCode.regional_admin, RoleCode.reviewer] },
      deletedAt: null
    },
    include: {
      regionalAdminProfile: {
        include: {
          region: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  // Format the output to be clean and useful for the client
  return users.map((user) => {
    const isReviewer = user.roles.includes(RoleCode.reviewer);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt,
      role: isReviewer ? "reviewer" : "regional_admin",
      status: isReviewer
        ? (user.accountStatus === AccountStatus.active ? "active" : "inactive")
        : (user.regionalAdminProfile?.status || "active"),
      regionId: isReviewer ? null : (user.regionalAdminProfile?.regionId || null),
      region: isReviewer
        ? { id: "all", name: "All Regions (Profile Reviewer)", code: "ALL" }
        : (user.regionalAdminProfile?.region ? {
            id: user.regionalAdminProfile.region.id,
            code: user.regionalAdminProfile.region.code,
            name: user.regionalAdminProfile.region.name
          } : null),
      plainPassword: isReviewer ? user.plainPassword : (user.regionalAdminProfile?.plainPassword || null)
    };
  });
}

export async function updateRegionalAdmin(id: string, input: UpdateRegionalAdminInput) {
  const existingUser = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { regionalAdminProfile: true }
  });

  if (!existingUser) {
    throw new ApiError(404, "User not found");
  }

  if (input.email && input.email !== existingUser.email) {
    const emailConflict = await prisma.user.findUnique({
      where: { email: input.email }
    });
    if (emailConflict) {
      throw new ApiError(400, "Email is already registered");
    }
  }

  const isReviewer = existingUser.roles.includes(RoleCode.reviewer);

  if (input.regionId && !isReviewer) {
    const region = await prisma.region.findFirst({
      where: { id: input.regionId, isActive: true, deletedAt: null }
    });
    if (!region) {
      throw new ApiError(404, "Target region not found or inactive");
    }
  }

  let passwordHash: string | undefined;
  if (input.password) {
    passwordHash = await bcrypt.hash(input.password, passwordSaltRounds);
  }

  let accountStatus: AccountStatus | undefined;
  let profileStatus: RegionalAdminStatus | undefined;
  if (input.status) {
    accountStatus = input.status === "active" ? AccountStatus.active : AccountStatus.disabled;
    profileStatus = input.status === "active" ? RegionalAdminStatus.active : RegionalAdminStatus.inactive;
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        ...(input.fullName ? { fullName: input.fullName } : {}),
        ...(input.email ? { email: input.email } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        ...(accountStatus ? { accountStatus } : {}),
        ...(input.password && isReviewer ? { plainPassword: input.password } : {})
      }
    });

    if (isReviewer) {
      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        createdAt: user.createdAt,
        role: "reviewer",
        status: user.accountStatus === AccountStatus.active ? "active" : "inactive",
        regionId: null,
        region: { id: "all", name: "All Regions (Profile Reviewer)", code: "ALL" },
        plainPassword: user.plainPassword || null
      };
    }

    const profile = await tx.regionalAdminProfile.update({
      where: { userId: id },
      data: {
        ...(input.regionId ? { regionId: input.regionId } : {}),
        ...(profileStatus ? { status: profileStatus } : {}),
        ...(input.password ? { plainPassword: input.password } : {})
      },
      include: {
        region: true
      }
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      createdAt: user.createdAt,
      role: "regional_admin",
      status: profile.status,
      regionId: profile.regionId,
      region: {
        id: profile.region.id,
        code: profile.region.code,
        name: profile.region.name
      },
      plainPassword: profile.plainPassword || null
    };
  });

  // Force-disconnect deactivated user from active socket sessions
  if (accountStatus === AccountStatus.disabled && io) {
    io.in(`user_${id}`).disconnectSockets(true);
  }

  return result;
}

export async function deleteRegionalAdmin(id: string) {
  const existingUser = await prisma.user.findFirst({
    where: { id, deletedAt: null }
  });

  if (!existingUser) {
    throw new ApiError(404, "User not found");
  }

  const isReviewer = existingUser.roles.includes(RoleCode.reviewer);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        accountStatus: AccountStatus.disabled
      }
    });

    if (!isReviewer) {
      await tx.regionalAdminProfile.update({
        where: { userId: id },
        data: {
          deletedAt: new Date(),
          status: RegionalAdminStatus.inactive
        }
      });
    }
  });

  // Force-disconnect deleted user from active socket sessions
  if (io) {
    io.in(`user_${id}`).disconnectSockets(true);
  }

  return { success: true };
}
