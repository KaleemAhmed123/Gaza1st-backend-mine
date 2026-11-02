import { asyncHandler, sendSuccess } from "../../shared/http";
import { actorFrom } from "./request-actor";
import { objectIdSchema } from "../../shared/validation";
import {
  createImpactStat,
  deleteImpactStat,
  listAdminImpactStats,
  listPublicImpactStats,
  reorderImpactStats,
  updateImpactStat
} from "./impact.service";
import { createImpactStatSchema, reorderImpactStatsSchema, updateImpactStatSchema } from "./impact.validation";

export const listPublicImpactHandler = asyncHandler(async (_req, res) => {
  const stats = await listPublicImpactStats();
  res.setHeader("Cache-Control", "public, max-age=60");
  sendSuccess(res, { stats });
});

export const listAdminImpactHandler = asyncHandler(async (_req, res) => {
  sendSuccess(res, { stats: await listAdminImpactStats() });
});

export const createImpactHandler = asyncHandler(async (req, res) => {
  const stat = await createImpactStat(createImpactStatSchema.parse(req.body), actorFrom(req));
  sendSuccess(res, { stat }, 201);
});

export const updateImpactHandler = asyncHandler(async (req, res) => {
  const id = objectIdSchema.parse(req.params.id);
  const stat = await updateImpactStat(id, updateImpactStatSchema.parse(req.body), actorFrom(req));
  sendSuccess(res, { stat });
});

export const deleteImpactHandler = asyncHandler(async (req, res) => {
  await deleteImpactStat(objectIdSchema.parse(req.params.id), actorFrom(req));
  sendSuccess(res, { deleted: true });
});

export const reorderImpactHandler = asyncHandler(async (req, res) => {
  const { ids } = reorderImpactStatsSchema.parse(req.body);
  sendSuccess(res, { stats: await reorderImpactStats(ids, actorFrom(req)) });
});
