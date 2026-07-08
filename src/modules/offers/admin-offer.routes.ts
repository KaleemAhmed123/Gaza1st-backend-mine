import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  exportAdminOffersHandler,
  getAdminOfferHandler,
  getAdminOfferRevisionsHandler,
  listAdminOffersHandler,
  reviewOfferHandler,
  assignOfferMentorHandler,
  deleteAdminOfferHandler,
  updateAdminOfferHandler
} from "./admin-offer.controller";

export const adminOfferRouter = Router();

adminOfferRouter.use(requireAuth);
adminOfferRouter.get("/export", exportAdminOffersHandler);
adminOfferRouter.get("/", listAdminOffersHandler);
adminOfferRouter.get("/:id/revisions", getAdminOfferRevisionsHandler);
adminOfferRouter.get("/:id", getAdminOfferHandler);
adminOfferRouter.patch("/:id", updateAdminOfferHandler);
adminOfferRouter.patch("/:id/review", reviewOfferHandler);
adminOfferRouter.patch("/:id/assign", assignOfferMentorHandler);
adminOfferRouter.delete("/:id", deleteAdminOfferHandler);
