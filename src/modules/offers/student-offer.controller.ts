import { asyncHandler, sendSuccess } from "../../shared/http";
import {
  createMyOffer,
  getMyOffer,
  listMyOffers,
  removeMyOffer,
  submitMyOffer,
  updateMyOffer
} from "./offer.service";
import { offerInputSchema } from "./offer.validation";

export const listMyOffersHandler = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const result = await listMyOffers(req.authUser!.id, { page, limit });
  sendSuccess(res, result);
});

export const getMyOfferHandler = asyncHandler(async (req, res) => {
  const offer = await getMyOffer(req.authUser!.id, req.params.id);
  sendSuccess(res, { offer });
});

export const createMyOfferHandler = asyncHandler(async (req, res) => {
  const input = offerInputSchema.parse(req.body);
  const offer = await createMyOffer(req.authUser!.id, input);
  sendSuccess(res, { offer }, 201);
});

export const updateMyOfferHandler = asyncHandler(async (req, res) => {
  const input = offerInputSchema.parse(req.body);
  const offer = await updateMyOffer({
    userId: req.authUser!.id,
    offerId: req.params.id,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { offer });
});

export const removeMyOfferHandler = asyncHandler(async (req, res) => {
  await removeMyOffer({
    userId: req.authUser!.id,
    offerId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { removed: true });
});

export const submitMyOfferHandler = asyncHandler(async (req, res) => {
  const offer = await submitMyOffer({
    userId: req.authUser!.id,
    offerId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { offer });
});
