import { asyncHandler, sendSuccess, ApiError } from "../../../shared/http";
import { prisma } from "../../../db/prisma";
import { processCsvImport } from "./csv-import.service";
import { parse } from "csv-parse/sync";

export const uploadCsvHandler = asyncHandler(async (req, res) => {
  const dataset = req.params.dataset as "universities" | "regions";
  if (!["universities", "regions"].includes(dataset)) {
    throw new ApiError(400, "Invalid dataset");
  }

  if (!req.file) {
    throw new ApiError(400, "No CSV file uploaded");
  }

  let totalRows = 0;
  try {
    const records = parse(req.file.buffer, { skip_empty_lines: true });
    totalRows = records.length;
    if (totalRows > 0 && typeof records[0][0] === "string" && records[0][0].toLowerCase().includes("name")) {
      totalRows -= 1;
    }
  } catch (e) {
    throw new ApiError(400, "Failed to parse CSV file");
  }

  const auditLog = await prisma.auditLog.create({
    data: {
      actorUserId: req.authUser!.id,
      action: "csv_import_job",
      entityType: dataset === "universities" ? "University" : "Region",
      metadata: {
        status: "processing",
        totalRows,
        processedRows: 0,
        results: []
      }
    }
  });

  // Background processing
  processCsvImport(auditLog.id, dataset, req.file.buffer).catch(console.error);

  sendSuccess(res, { auditLogId: auditLog.id });
});

export const getCsvImportHistoryHandler = asyncHandler(async (req, res) => {
  const dataset = req.params.dataset as "universities" | "regions";
  if (!["universities", "regions"].includes(dataset)) {
    throw new ApiError(400, "Invalid dataset");
  }
  
  const entityType = dataset === "universities" ? "University" : "Region";

  const logs = await prisma.auditLog.findMany({
    where: {
      action: "csv_import_job",
      entityType
    },
    orderBy: { createdAt: "desc" }
  });

  // Strip results to keep the payload small
  const summaryLogs = logs.map(log => {
    const meta = log.metadata as any;
    if (meta && meta.results) {
      delete meta.results;
    }
    return { ...log, metadata: meta };
  });

  sendSuccess(res, { logs: summaryLogs });
});

export const getCsvImportLogDetailsHandler = asyncHandler(async (req, res) => {
  const { dataset, logId } = req.params;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;

  if (!["universities", "regions"].includes(dataset)) {
    throw new ApiError(400, "Invalid dataset");
  }

  const log = await prisma.auditLog.findUnique({
    where: { id: logId }
  });

  if (!log) {
    throw new ApiError(404, "Log not found");
  }

  const meta = log.metadata as any;
  const allResults = meta?.results || [];
  const total = allResults.length;
  
  const startIndex = (page - 1) * limit;
  const paginatedResults = allResults.slice(startIndex, startIndex + limit);

  sendSuccess(res, { 
    results: paginatedResults,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  });
});
