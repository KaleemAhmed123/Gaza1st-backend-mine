import { RoleCode } from "@prisma/client";
import { Router } from "express";
import { requireRole, requireAuth } from "../../middleware/auth.middleware";
import {
  createConfigOptionHandler,
  createRegionHandler,
  createUniversityHandler,
  deactivateConfigOptionHandler,
  deactivateRegionHandler,
  deactivateUniversityHandler,
  listAllRegionsAdminHandler,
  listAllUniversitiesAdminHandler,
  listConfigOptionsHandler,
  listRegionsHandler,
  listUniversitiesHandler,
  updateConfigOptionHandler,
  updateRegionHandler,
  updateUniversityHandler
} from "./config.controller";
import {
  getConfigHandler,
  getPublicConfigHandler,
  listConfigsHandler,
  updateConfigHandler
} from "./app-config.controller";

export const configRouter = Router();
export const adminConfigRouter = Router();

configRouter.get("/regions", listRegionsHandler);
configRouter.get("/universities", listUniversitiesHandler);
configRouter.get("/options", listConfigOptionsHandler);
configRouter.get("/app/public/:key", getPublicConfigHandler);
configRouter.get("/roles", (req, res) => {
  res.json({ roles: Object.values(RoleCode) });
});

adminConfigRouter.use(requireAuth, requireRole([RoleCode.master_admin]));
adminConfigRouter.get("/regions", listAllRegionsAdminHandler);
adminConfigRouter.get("/universities", listAllUniversitiesAdminHandler);
adminConfigRouter.post("/options", createConfigOptionHandler);
adminConfigRouter.patch("/options/:id", updateConfigOptionHandler);
adminConfigRouter.delete("/options/:id", deactivateConfigOptionHandler);
adminConfigRouter.post("/regions", createRegionHandler);
adminConfigRouter.patch("/regions/:id", updateRegionHandler);
adminConfigRouter.delete("/regions/:id", deactivateRegionHandler);
adminConfigRouter.post("/universities", createUniversityHandler);
adminConfigRouter.patch("/universities/:id", updateUniversityHandler);
adminConfigRouter.delete("/universities/:id", deactivateUniversityHandler);

adminConfigRouter.get("/app", listConfigsHandler);
adminConfigRouter.get("/app/:key", getConfigHandler);
adminConfigRouter.put("/app/:key", updateConfigHandler);
