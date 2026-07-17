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
