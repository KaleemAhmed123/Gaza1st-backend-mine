import { csvFilename } from "../../shared/csv";
import { asyncHandler, sendSuccess } from "../../shared/http";
import {
  exportAdminOffersCsv,
  getAdminOffer,
  getAdminOfferRevisions,
  listAdminOffers,
  reviewOffer,
  assignMentorToOffer,
  removeOfferAsAdmin
} from "./offer.service";
import { listAdminOffersQuerySchema, reviewOfferSchema, assignOfferMentorSchema } from "./offer.validation";

export const listAdminOffersHandler = asyncHandler(async (req, res) => {
  const query = listAdminOffersQuerySchema.parse(req.query);
  const offers = await listAdminOffers(req.authUser!.id, query);
  sendSuccess(res, { offers });
});

export const exportAdminOffersHandler = asyncHandler(async (req, res) => {
  const query = listAdminOffersQuerySchema.parse(req.query);
  const csv = await exportAdminOffersCsv({
    userId: req.authUser!.id,
    query,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${csvFilename("offers-export")}"`);
  res.send(csv);
});

export const getAdminOfferHandler = asyncHandler(async (req, res) => {
  const offer = await getAdminOffer(req.authUser!.id, req.params.id);
  sendSuccess(res, { offer });
});

export const getAdminOfferRevisionsHandler = asyncHandler(async (req, res) => {
  const revisions = await getAdminOfferRevisions(req.authUser!.id, req.params.id);
  sendSuccess(res, { revisions });
});

export const reviewOfferHandler = asyncHandler(async (req, res) => {
  const input = reviewOfferSchema.parse(req.body);
  const offer = await reviewOffer({
    userId: req.authUser!.id,
    offerId: req.params.id,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { offer });
});

export const assignOfferMentorHandler = asyncHandler(async (req, res) => {
  const input = assignOfferMentorSchema.parse(req.body);
  const offer = await assignMentorToOffer({
    userId: req.authUser!.id,
    offerId: req.params.id,
    mentorId: input.mentorId,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { offer });
});

export const deleteAdminOfferHandler = asyncHandler(async (req, res) => {
  await removeOfferAsAdmin({
    userId: req.authUser!.id,
    offerId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { success: true });
});
