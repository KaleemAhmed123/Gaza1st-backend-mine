import fs from "fs";
import path from "path";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import { recordAuditLog } from "../../shared/audit";
import { RoleCode, CsvJobStatus, type CsvJob } from "@prisma/client";
import { uploadCsv, getCsvDownloadUrl, deleteCsvFromStorage } from "./csv-storage.service";
import { runStudentExport } from "./student-export.service";
import { runMentorExport } from "./mentor-export.service";
import { runRegionalAdminExport } from "./regional-admin-export.service";
import { env } from "../../config/env";
import type { GenerateCsvBody, ListCsvJobsQuery } from "./csv-generator.validation";
import type { CsvScope } from "./csv-query-builder";

// ─── CSV versions — bump when column schema changes ──────────────────────────
const CSV_VERSION: Record<string, string> = {
  students:        "students-v1",
  mentors:         "mentors-v1",
  regional_admins: "regional_admins-v1",
};

// ─── Scope resolution ─────────────────────────────────────────────────────────

async function resolveScope(userId: string, roles: string[]): Promise<CsvScope> {
  if (roles.includes(RoleCode.master_admin)) {
    return { role: "master_admin" };
  }

  if (roles.includes(RoleCode.regional_admin)) {
    const profile = await prisma.regionalAdminProfile.findFirst({
      where: { userId, deletedAt: null, status: "active" },
      select: { regionId: true },
    });
    if (!profile) throw new ApiError(403, "Regional admin profile not found or inactive");
    return { role: "regional_admin", regionId: profile.regionId };
  }

  throw new ApiError(403, "Insufficient permissions");
}

// ─── Filter summary builder ───────────────────────────────────────────────────

async function buildFilterSummary(body: GenerateCsvBody): Promise<string> {
  const parts: string[] = [];
  const filters = body.filters as Record<string, unknown> | undefined ?? {};

  if (filters.regionId) {
    const region = await prisma.region.findUnique({ where: { id: String(filters.regionId) }, select: { name: true } });
    if (region) parts.push(`Country: ${region.name}`);
  }
  if (filters.universityId) {
    const uni = await prisma.university.findUnique({ where: { id: String(filters.universityId) }, select: { name: true } });
    if (uni) parts.push(`University: ${uni.name}`);
  }
  if (filters.scholarshipName)  parts.push(`Scholarship: ${filters.scholarshipName}`);
  if (filters.financialGapExists !== undefined) parts.push(`Financial Gap Exists: ${filters.financialGapExists}`);
  if (filters.approvedOffer !== undefined) parts.push(`Approved: ${filters.approvedOffer}`);
  if (filters.activeOffer   !== undefined) parts.push(`Active: ${filters.activeOffer}`);

  return parts.length > 0 ? parts.join(", ") : "No additional filters";
}

// ─── Permission validation ────────────────────────────────────────────────────

function validatePermissions(body: GenerateCsvBody, scope: CsvScope): void {
  const { dataset } = body;
  const filters = body.filters as Record<string, unknown> | undefined ?? {};

  if (scope.role === "regional_admin") {
    // RA can only generate students, mentors, or their own regional_admin record
    if (!["students", "mentors", "regional_admins"].includes(dataset)) {
      throw new ApiError(403, "Regional Admin can only generate student, mentor, or regional admin CSV");
    }
    if (filters.regionId && filters.regionId !== scope.regionId) {
      throw new ApiError(403, "Regional Admin can only export data for their assigned region");
    }
    return;
  }

  // Master Admin: must supply regionId for student/mentor CSV (reduces DB load)
  if (dataset === "students" || dataset === "mentors") {
    if (!filters.regionId && !filters.universityId) {
      throw new ApiError(400, "Admin must select at least Country or University for student/mentor CSV export");
    }
  }
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

async function findDuplicateJob(userId: string, body: GenerateCsvBody): Promise<CsvJob | null> {
  const windowMs = 5 * 60 * 1000;
  const since    = new Date(Date.now() - windowMs);

  const recentJobs = await prisma.csvJob.findMany({
    where: {
      requestedByUserId: userId,
      dataset: body.dataset as any,
      status: { notIn: [CsvJobStatus.failed, CsvJobStatus.expired] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });

  const bodyFilters  = JSON.stringify(body.filters ?? null);
  const bodyCols     = JSON.stringify([...(body.columns ?? [])].sort());

  for (const job of recentJobs) {
    if (
      JSON.stringify(job.filters ?? null) === bodyFilters &&
      JSON.stringify([...(job.columns ?? [])].sort()) === bodyCols &&
      job.dateRangeField === body.dateRangeField &&
      job.dateRangeFrom.toISOString() === body.dateRangeFrom.toISOString() &&
      job.dateRangeTo.toISOString()   === body.dateRangeTo.toISOString()
    ) {
      return job;
    }
  }
  return null;
}

// ─── Progress callback ────────────────────────────────────────────────────────

function makeProgressCallback(jobId: string) {
  return async (processedRows: number) => {
    await prisma.csvJob.update({ where: { id: jobId }, data: { processedRows } });
  };
}

// ─── Background runner ────────────────────────────────────────────────────────

export async function runCsvJob(jobId: string): Promise<void> {
  const startedAt = Date.now();

  await prisma.csvJob.update({
    where: { id: jobId },
    data: { status: CsvJobStatus.generating },
  });

  try {
    const job = await prisma.csvJob.findUniqueOrThrow({ where: { id: jobId } });

    if (job.cancelRequested) {
      await prisma.csvJob.update({ where: { id: jobId }, data: { status: CsvJobStatus.failed, errorMessage: "Cancelled before generation started" } });
      return;
    }

    // Re-resolve body from stored job fields (needed by export services)
    const body: GenerateCsvBody = {
      dataset:        job.dataset as any,
      dateRangeField: job.dateRangeField as any,
      dateRangeFrom:  job.dateRangeFrom,
      dateRangeTo:    job.dateRangeTo,
      columns:        job.columns,
      filters:        (job.filters as any) ?? undefined,
    };

    const scope: CsvScope = job.filters && (job.filters as any)._scope
      ? (job.filters as any)._scope
      : await resolveScope(job.requestedByUserId, []); // fallback — scope resolved from stored regionId

    const onProgress = makeProgressCallback(jobId);

    let result: { filePath: string; rowCount: number; fileSizeBytes: number };

    if (job.dataset === "students") {
      result = await runStudentExport(job, body as any, scope, onProgress);
    } else if (job.dataset === "mentors") {
      result = await runMentorExport(job, body as any, scope, onProgress);
    } else {
      result = await runRegionalAdminExport(job, body as any, scope, onProgress);
    }

    // Check cancellation one final time before uploading
    const finalCheck = await prisma.csvJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
    if (finalCheck?.cancelRequested) {
      const fs = await import("fs/promises");
      await fs.unlink(result.filePath).catch(() => {});
      await prisma.csvJob.update({ where: { id: jobId }, data: { status: CsvJobStatus.failed, errorMessage: "Cancelled" } });
      return;
    }

    const fs = await import("fs/promises");
    const csvBuffer = await fs.readFile(result.filePath);
    const { key, bucket } = await uploadCsv(csvBuffer, jobId, job.dataset);

    // Clean up temporary file
    await fs.unlink(result.filePath).catch(() => {});
    
    const expiresAt = new Date(Date.now() + env.CSV_SIGNED_URL_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.csvJob.update({
      where: { id: jobId },
      data: {
        status:              CsvJobStatus.completed,
        storageKey:          key,
        storageBucket:       bucket,
        rowCount:            result.rowCount,
        fileSizeBytes:       result.fileSizeBytes,
        processedRows:       result.rowCount,
        generationDurationMs: Date.now() - startedAt,
        expiresAt,
        completedAt:         new Date(),
        errorMessage:        null,
      },
    });

    await recordAuditLog({
      actorUserId: job.requestedByUserId,
      action:      "csv_export_completed",
      entityType:  "CsvJob",
      entityId:    jobId,
      metadata:    { dataset: job.dataset, rowCount: result.rowCount },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.csvJob.update({
      where:  { id: jobId },
      data:   { status: CsvJobStatus.failed, errorMessage: message },
    }).catch(console.error);
  }
}

// ─── Public service methods ───────────────────────────────────────────────────

export async function createCsvJob(
  userId: string,
  roles:  string[],
  body:   GenerateCsvBody,
  meta:   { ipAddress?: string; userAgent?: string }
) {
  const scope = await resolveScope(userId, roles);
  validatePermissions(body, scope);

  // Duplicate check
  const duplicate = await findDuplicateJob(userId, body);
  if (duplicate) {
    return { jobId: duplicate.id, status: duplicate.status, duplicate: true };
  }

  // Active jobs limit to prevent DoS
  const activeJobsCount = await prisma.csvJob.count({
    where: {
      requestedByUserId: userId,
      status: { in: [CsvJobStatus.pending, CsvJobStatus.generating] },
    },
  });

  if (activeJobsCount >= 2) {
    throw new ApiError(429, "You already have two CSV exports in progress. Please wait for them to finish.");
  }

  const filterSummary = await buildFilterSummary(body);

  // Store scope inside filters so runCsvJob can reconstruct it without a DB call
  const filtersWithScope = {
    ...(body.filters ?? {}),
    _scope: scope,
  };

  const job = await prisma.csvJob.create({
    data: {
      requestedByUserId: userId,
      dataset:           body.dataset as any,
      status:            CsvJobStatus.pending,
      csvVersion:        CSV_VERSION[body.dataset],
      filters:           filtersWithScope as any,
      filterSummary,
      columns:           body.columns,
      dateRangeField:    body.dateRangeField,
      dateRangeFrom:     body.dateRangeFrom,
      dateRangeTo:       body.dateRangeTo,
    },
  });

  // Fire and forget — no await
  runCsvJob(job.id).catch((err) => console.error(`CSV job ${job.id} failed:`, err));

  await recordAuditLog({
    actorUserId: userId,
    action:      "csv_export_requested",
    entityType:  "CsvJob",
    entityId:    job.id,
    metadata:    { dataset: body.dataset, filterSummary },
    ipAddress:   meta.ipAddress,
    userAgent:   meta.userAgent,
  });

  return { jobId: job.id, status: job.status, duplicate: false };
}

export async function listCsvJobs(userId: string, roles: string[], query: ListCsvJobsQuery) {
  const isMasterAdmin = roles.includes(RoleCode.master_admin);
  const skip = (query.page - 1) * query.pageSize;

  const where = isMasterAdmin ? {} : { requestedByUserId: userId };

  const [jobs, total] = await Promise.all([
    prisma.csvJob.findMany({
      where,
      include: { requestedBy: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.csvJob.count({ where }),
  ]);

  return {
    jobs: jobs.map(formatJobResponse),
    pagination: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function getCsvJob(userId: string, roles: string[], jobId: string) {
  const job = await prisma.csvJob.findFirst({
    where: buildJobWhere(userId, roles, jobId),
    include: { requestedBy: { select: { id: true, fullName: true } } },
  });
  if (!job) throw new ApiError(404, "CSV job not found");
  return formatJobResponse(job);
}

export async function getCsvJobDownloadUrl(userId: string, roles: string[], jobId: string) {
  const job = await prisma.csvJob.findFirst({ where: buildJobWhere(userId, roles, jobId) });
  if (!job) throw new ApiError(404, "CSV job not found");

  if (job.status === CsvJobStatus.expired) throw new ApiError(410, "CSV has expired and is no longer available");
  if (job.status !== CsvJobStatus.completed) throw new ApiError(400, `CSV is not ready (status: ${job.status})`);

  if (job.expiresAt && job.expiresAt < new Date()) {
    throw new ApiError(410, "CSV has expired");
  }

  if (job.storageBucket === "local_private") {
    // Return relative backend endpoint for direct local download
    return {
      url: `/api/csv-generator/${job.id}/download-file`,
      expiresAt: job.expiresAt
    };
  }

  if (!job.storageKey || !job.storageBucket) {
    throw new ApiError(404, "CSV file is no longer available. Please regenerate the export.");
  }

  const url = await getCsvDownloadUrl(job.storageKey, job.storageBucket);
  if (!url) {
    // Signed URL generation failed (e.g. a transient storage/credential issue).
    // Return a clear, retryable error rather than a generic 500.
    throw new ApiError(503, "Could not generate the download link right now. Please try again in a moment.");
  }

  return { url, expiresAt: job.expiresAt };
}

export async function getCsvJobFile(userId: string, roles: string[], jobId: string) {
  const job = await prisma.csvJob.findFirst({ where: buildJobWhere(userId, roles, jobId) });
  if (!job) throw new ApiError(404, "CSV job not found");

  if (job.status === CsvJobStatus.expired) throw new ApiError(410, "CSV has expired and is no longer available");
  if (job.status !== CsvJobStatus.completed) throw new ApiError(400, `CSV is not ready (status: ${job.status})`);

  if (job.expiresAt && job.expiresAt < new Date()) {
    throw new ApiError(410, "CSV has expired");
  }

  const filename = `${job.dataset}-${jobId}.csv`;

  if (job.storageBucket === "local_private") {
    const filePath = path.resolve(process.cwd(), job.storageKey!);
    const expectedRoot = path.resolve(process.cwd(), "csv-exports");
    if (!filePath.startsWith(expectedRoot)) {
      throw new ApiError(400, "Invalid storage key");
    }
    if (!fs.existsSync(filePath)) {
      throw new ApiError(404, "CSV file not found on disk");
    }
    return { isLocal: true, filePath, filename };
  }

  // Fallback for non-local R2 file: get signed URL
  const url = await getCsvDownloadUrl(job.storageKey!, job.storageBucket!);
  return { isLocal: false, url, filename };
}

export async function deleteCsvJob(userId: string, roles: string[], jobId: string) {
  const job = await prisma.csvJob.findFirst({ where: buildJobWhere(userId, roles, jobId) });
  if (!job) throw new ApiError(404, "CSV job not found");

  if (job.status === CsvJobStatus.pending) {
    await prisma.csvJob.update({ where: { id: jobId }, data: { cancelRequested: true, status: CsvJobStatus.failed, errorMessage: "Cancelled by user" } });
    return { success: true };
  }

  if (job.status === CsvJobStatus.generating) {
    // Cooperative cancel — runner will notice cancelRequested on next batch
    await prisma.csvJob.update({ where: { id: jobId }, data: { cancelRequested: true } });
    return { success: true };
  }

  // completed or expired — delete from R2 and mark expired
  if (job.storageKey && job.storageBucket) {
    await deleteCsvFromStorage(job.storageKey, job.storageBucket);
  }
  await prisma.csvJob.update({ where: { id: jobId }, data: { status: CsvJobStatus.expired } });
  return { success: true };
}

export async function retryCsvJob(userId: string, roles: string[], jobId: string) {
  const job = await prisma.csvJob.findFirst({ where: buildJobWhere(userId, roles, jobId) });
  if (!job) throw new ApiError(404, "CSV job not found");
  if (job.status !== CsvJobStatus.failed) throw new ApiError(400, "Only failed jobs can be retried");

  await prisma.csvJob.update({
    where: { id: jobId },
    data: {
      status:         CsvJobStatus.pending,
      processedRows:  0,
      cancelRequested:false,
      errorMessage:   null,
    },
  });

  runCsvJob(jobId).catch((err) => console.error(`CSV job retry ${jobId} failed:`, err));
  return { jobId, status: CsvJobStatus.pending };
}

export async function cleanupExpiredCsvJobs(): Promise<void> {
  const now = new Date();
  const expiredJobs = await prisma.csvJob.findMany({
    where: { status: CsvJobStatus.completed, expiresAt: { lt: now } },
    select: { id: true, storageKey: true, storageBucket: true },
  });

  let count = 0;
  for (const job of expiredJobs) {
    if (job.storageKey && job.storageBucket) {
      await deleteCsvFromStorage(job.storageKey, job.storageBucket).catch(console.error);
    }
    await prisma.csvJob.update({ where: { id: job.id }, data: { status: CsvJobStatus.expired } });
    count++;
  }

  if (count > 0) {
    console.log(`[csv-cleanup] Expired ${count} CSV job(s)`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildJobWhere(userId: string, roles: string[], jobId: string) {
  const isMasterAdmin = roles.includes(RoleCode.master_admin);
  return {
    id: jobId,
    ...(isMasterAdmin ? {} : { requestedByUserId: userId }),
  };
}

function formatJobResponse(job: CsvJob & { requestedBy?: { id: string; fullName: string } }) {
  // Strip internal _scope from filters before returning to client
  const { _scope, ...cleanFilters } = (job.filters as any) ?? {};
  return {
    id:                   job.id,
    dataset:              job.dataset,
    csvVersion:           job.csvVersion,
    status:               job.status,
    generatedBy:          job.requestedBy ?? null,
    filterSummary:        job.filterSummary,
    dateRangeField:       job.dateRangeField,
    dateRangeFrom:        job.dateRangeFrom,
    dateRangeTo:          job.dateRangeTo,
    columns:              job.columns,
    processedRows:        job.processedRows,
    rowCount:             job.rowCount,
    fileSizeBytes:        job.fileSizeBytes,
    generationDurationMs: job.generationDurationMs,
    errorMessage:         job.errorMessage,
    expiresAt:            job.expiresAt,
    createdAt:            job.createdAt,
    completedAt:          job.completedAt,
  };
}
