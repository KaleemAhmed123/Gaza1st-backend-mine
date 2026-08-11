import { asyncHandler, sendSuccess } from "../../shared/http";
import { listMentorOffers, reviewOffer } from "./offer.service";
import { reviewOfferSchema } from "./offer.validation";

export const listMentorOffersHandler = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const result = await listMentorOffers(req.authUser!.id, { page, limit });
  sendSuccess(res, result);
});

export const reviewMentorOfferHandler = asyncHandler(async (req, res) => {
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
