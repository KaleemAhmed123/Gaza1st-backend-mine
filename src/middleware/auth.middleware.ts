import type { NextFunction, Request, Response } from "express";
import { RoleCode, VolunteerStatus, type RoleCode as RoleCodeType } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ApiError } from "../shared/http";
import { verifyAccessToken } from "../modules/auth/token";

export type AuthUser = {
  id: string;
  email: string;
  roles: RoleCodeType[];
  regionId?: string;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken;

  if (!token) {
    next(new ApiError(401, "Authentication required"));
    return;
  }

  try {
    req.authUser = verifyAccessToken(token);
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired authentication token"));
  }
}

const selfSignupRoles: RoleCodeType[] = [RoleCode.student, RoleCode.mentor];

// Gates the app for self-signup users (students/mentors) until their email is verified.
// Admin-created roles are exempt. No/invalid token => pass through so requireAuth handles 401 downstream.
export async function requireVerified(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.accessToken;
  if (!token) {
    next();
    return;
  }

  let authUser: AuthUser;
  try {
    authUser = verifyAccessToken(token);
  } catch {
    next();
    return;
  }

  if (!authUser.roles.some((role) => selfSignupRoles.includes(role))) {
    next();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: authUser.id },
    select: { emailVerifiedAt: true }
  });

  if (user && !user.emailVerifiedAt) {
    next(new ApiError(403, "Please verify your email address to continue.", "EMAIL_NOT_VERIFIED"));
    return;
  }

  next();
}

// Always mounted after requireAuth, so req.authUser is already populated — re-reading and
// re-verifying the cookie here would just be a second copy of that logic.
export async function requireCommunityGuidelines(req: Request, _res: Response, next: NextFunction) {
  const authUser = req.authUser;

  // Only students are gated.
  if (!authUser || !authUser.roles.includes(RoleCode.student)) {
    next();
    return;
  }

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: authUser.id },
    select: { communityGuidelinesApproved: true }
  });

  // No profile means they have not been through onboarding, so they have not approved
  // anything — block rather than pass. (Profiles are created lazily on first access to
  // /api/student/profile/me, which is deliberately not gated so onboarding still works.)
  if (!profile?.communityGuidelinesApproved) {
    next(new ApiError(403, "You must approve the Community Guidelines.", "COMMUNITY_GUIDELINES_NOT_APPROVED"));
    return;
  }

  next();
}

export function requireRole(allowedRoles: RoleCodeType[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.authUser) {
      next(new ApiError(401, "Authentication required"));
      return;
    }

    const hasRole = req.authUser.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      next(new ApiError(403, "You do not have permission to access this resource"));
      return;
    }

    next();
  };
}

export async function requireActiveMentor(req: Request, _res: Response, next: NextFunction) {
  if (!req.authUser) {
    next(new ApiError(401, "Authentication required"));
    return;
  }

  if (!req.authUser.roles.includes(RoleCode.mentor)) {
    next(new ApiError(403, "Mentor account is not active yet"));
    return;
  }

  const profile = await prisma.volunteerProfile.findUnique({
    where: { userId: req.authUser.id },
    select: { volunteerStatus: true }
  });
  if (!profile || profile.volunteerStatus !== VolunteerStatus.approved) {
    next(new ApiError(403, "Your mentor account is pending approval"));
    return;
  }

  next();
}
