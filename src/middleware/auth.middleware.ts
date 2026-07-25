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
    next(new ApiError(403, "Please verify your email address to continue."));
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

export function requireActiveMentor(req: Request, _res: Response, next: NextFunction) {
  if (!req.authUser) {
    next(new ApiError(401, "Authentication required"));
    return;
  }

  if (!req.authUser.roles.includes(RoleCode.mentor)) {
    next(new ApiError(403, "Mentor account is not active yet"));
    return;
  }

  next();
}
