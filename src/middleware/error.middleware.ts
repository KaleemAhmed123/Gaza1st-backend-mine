import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError } from "../shared/http";
import * as Sentry from "@sentry/node";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.path}`));
}

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: { message: "Invalid JSON request body" } });
    return;
  }

  if (error instanceof ApiError) {
    // 403s are otherwise invisible: not 5xx, so no Sentry alert; not logged
    // anywhere with request context. Capture as a low-severity breadcrumb so a
    // reported "permission denied" incident can be looked up instead of guessed at.
    if (error.statusCode === 403) {
      Sentry.captureMessage(`403 Forbidden${error.code ? `: ${error.code}` : ""}`, {
        level: "warning",
        extra: {
          path: req.originalUrl,
          method: req.method,
          code: error.code,
          message: error.message,
          userId: req.authUser?.id,
          userAgent: req.get("user-agent"),
          ipAddress: req.ip
        }
      });
    }

    res.status(error.statusCode).json({
      error: { message: error.message, ...(error.code ? { code: error.code } : {}) }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: "Validation failed",
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: { message: error.message } });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({ error: { message: "A record with this value already exists" } });
      return;
    }

    if (error.code === "P2003") {
      res.status(400).json({ error: { message: "Related record does not exist" } });
      return;
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    res.status(503).json({
      error: {
        message: "Database temporarily unavailable. Please retry in a moment."
      }
    });
    return;
  }

  Sentry.captureException(error);
  console.error(error);
  res.status(500).json({ error: { message: "Internal server error" } });
}
