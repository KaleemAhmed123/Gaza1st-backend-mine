import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { RoleCode } from "@prisma/client";
import multer from "multer";
import { getCsvImportHistoryHandler, uploadCsvHandler, getCsvImportLogDetailsHandler } from "./csv-import.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

export const adminCsvImportRouter = Router();

adminCsvImportRouter.use(requireAuth, requireRole([RoleCode.master_admin, RoleCode.regional_admin]));

adminCsvImportRouter.post("/:dataset", upload.single("file"), uploadCsvHandler);
adminCsvImportRouter.get("/:dataset/history", getCsvImportHistoryHandler);
adminCsvImportRouter.get("/:dataset/history/:logId", getCsvImportLogDetailsHandler);
