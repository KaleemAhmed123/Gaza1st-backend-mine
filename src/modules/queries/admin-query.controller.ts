import { asyncHandler, sendSuccess } from "../../shared/http";
import {
  addAdminMessage,
  assignQuery,
  escalateAdminQuery,
  getAdminQuery,
  listAdminQueries,
  resolveAdminQuery,
  reopenAdminQuery
} from "./query.service";
import {
  addQueryMessageSchema,
  assignQuerySchema,
  escalateQuerySchema,
  listQueriesQuerySchema
} from "./query.validation";

export const listAdminQueriesHandler = asyncHandler(async (req, res) => {
  const queryInput = listQueriesQuerySchema.parse(req.query);
  const queries = await listAdminQueries(req.authUser!.id, queryInput);
  sendSuccess(res, { queries });
});

export const getAdminQueryHandler = asyncHandler(async (req, res) => {
  const query = await getAdminQuery(req.authUser!.id, req.params.id);
  sendSuccess(res, { query });
});

export const assignQueryHandler = asyncHandler(async (req, res) => {
  const input = assignQuerySchema.parse(req.body);
  const query = await assignQuery({
    userId: req.authUser!.id,
    queryId: req.params.id,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { query });
});

export const addAdminQueryMessageHandler = asyncHandler(async (req, res) => {
  const input = addQueryMessageSchema.parse(req.body);
  const message = await addAdminMessage({
    userId: req.authUser!.id,
    queryId: req.params.id,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { message }, 201);
});

export const resolveAdminQueryHandler = asyncHandler(async (req, res) => {
  const query = await resolveAdminQuery({
    userId: req.authUser!.id,
    queryId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { query });
});

export const reopenAdminQueryHandler = asyncHandler(async (req, res) => {
  const query = await reopenAdminQuery({
    userId: req.authUser!.id,
    queryId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { query });
});

export const escalateAdminQueryHandler = asyncHandler(async (req, res) => {
  const input = escalateQuerySchema.parse(req.body);
  const query = await escalateAdminQuery({
    userId: req.authUser!.id,
    queryId: req.params.id,
    data: input,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });
  sendSuccess(res, { query });
});
