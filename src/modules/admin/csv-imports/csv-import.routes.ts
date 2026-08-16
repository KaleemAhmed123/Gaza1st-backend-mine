import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { RoleCode } from "@prisma/client";
import multer from "multer";
import { uploadCsvHandler } from "./csv-import.controller";

// Regions and universities are name/code pairs — a 5000 row file is well under 1MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

export const adminCsvImportRouter = Router();

adminCsvImportRouter.use(requireAuth, requireRole([RoleCode.master_admin, RoleCode.regional_admin]));

adminCsvImportRouter.post("/:dataset", upload.single("file"), uploadCsvHandler);
