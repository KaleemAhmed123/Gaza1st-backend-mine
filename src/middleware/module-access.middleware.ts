import type { NextFunction, Request, Response } from "express";
import { getAppConfig } from "../modules/config/app-config.service";
import { ApiError } from "../shared/http";

export type PlatformModuleKey =
  | "announcements"
  | "volunteers"
  | "student_profile"
  | "students"
  | "offers"
  | "queries"
  | "chat"
  | "regional_admins"
  | "csv_generator"
  | "audit_logs";

interface CachedControls {
  data: Record<string, boolean>;
  timestamp: number;
}

let cachedControls: CachedControls | null = null;
const CACHE_TTL_MS = 15000; // 15 seconds

export function invalidateModuleAccessCache(): void {
  cachedControls = null;
}

export async function getModuleControls(): Promise<Record<string, boolean>> {
  const now = Date.now();
  if (cachedControls && now - cachedControls.timestamp < CACHE_TTL_MS) {
    return cachedControls.data;
  }

  try {
    const raw = await getAppConfig("navigation_tab_controls");
    const controls = (raw && typeof raw === "object" ? raw : {}) as Record<string, boolean>;
    cachedControls = { data: controls, timestamp: now };
    return controls;
  } catch (error) {
    console.error("Failed to load navigation_tab_controls:", error);
    return cachedControls ? cachedControls.data : {};
  }
}

export function requireModuleEnabled(moduleKey: PlatformModuleKey) {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const controls = await getModuleControls();
      // If explicitly set to false, block access globally
      if (controls[moduleKey] === false) {
        next(
          new ApiError(
            403,
            `The ${moduleKey.replace(/_/g, " ")} module is currently disabled by platform administrator.`,
            "MODULE_DISABLED"
          )
        );
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
