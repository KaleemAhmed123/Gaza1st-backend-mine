import { prisma } from "../../db/prisma";
import { formatCsvRow } from "../../shared/csv";
import { createShortLink } from "../documents/csv-doc-token";
import { calculateOfferFinancialSummary, parseFinancialRules } from "../offers/offer-financial";
import { REGIONAL_ADMIN_COLUMNS } from "./csv-column-definitions";
import type { CsvJob } from "@prisma/client";
import type { CsvScope } from "./csv-query-builder";
import type { RegionalAdminCsvBody } from "./csv-generator.validation";
import { env } from "../../config/env";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const BATCH_SIZE = 1000;

function pickColumns(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    out[REGIONAL_ADMIN_COLUMNS[col]?.label ?? col] = row[col] ?? "";
  }
  return out;
}

export async function runRegionalAdminExport(
  job: CsvJob,
  body: RegionalAdminCsvBody,
  scope: CsvScope,
  onProgress: (processed: number) => Promise<void>
): Promise<{ filePath: string; rowCount: number; fileSizeBytes: number }> {

  const appConfig = await prisma.appConfig.findUnique({ where: { key: "offer_financial_rules" } });
  const financialRules = appConfig ? parseFinancialRules(appConfig.value) : null;

  const apiBase = env.FRONTEND_URL.replace(/\/$/, "");
  const filters = body.filters ?? {};

  const regionId = scope.role === "regional_admin" ? scope.regionId : filters.regionId;

  const offerDateFilter = body.dateRangeField === "offerCreatedAt"
    ? { createdAt: { gte: body.dateRangeFrom, lte: body.dateRangeTo } }
    : {};

  const adminDateFilter = body.dateRangeField === "regionalAdminSignupDate"
    ? { createdAt: { gte: body.dateRangeFrom, lte: body.dateRangeTo } }
    : {};

  const adminProfiles = await prisma.regionalAdminProfile.findMany({
    where: {
      deletedAt: null,
      status: "active",
      ...(regionId ? { regionId } : {}),
      ...(scope.role === "regional_admin" ? { userId: (job as any).requestedByUserId } : {}),
      ...(Object.keys(adminDateFilter).length ? { user: adminDateFilter } : {}),
    },
    select: {
      userId: true,
      status: true,
      regionId: true,
      region: { select: { code: true, name: true } },
      user: { select: { id: true, fullName: true, email: true, phone: true, createdAt: true } },
    },
  });

  const tempFilePath = path.join(os.tmpdir(), `csv-regional-${job.id}.csv`);
  const fileHandle = await fs.open(tempFilePath, 'w');
  
  const headers = job.columns.map((col: string) => REGIONAL_ADMIN_COLUMNS[col]?.label ?? col);
  await fileHandle.write(formatCsvRow(Object.fromEntries(headers.map((h: string) => [h, h])), headers) + "\n");

  let totalProcessed = 0;
  let rowCount = 0;

  for (const adminProfile of adminProfiles) {
    const admin = adminProfile.user;
    let cursor: string | undefined;

    while (true) {
      const jobCheck = await prisma.csvJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } });
      if (jobCheck?.cancelRequested) {
        await fileHandle.close();
        await fs.unlink(tempFilePath).catch(() => {});
        throw new Error("Cancelled");
      }

      const offers = await prisma.offer.findMany({
        where: {
          deletedAt: null,
          regionId: adminProfile.regionId,
          ...(filters.universityId ? { universityId: filters.universityId } : {}),
          ...(filters.approvedOffer !== undefined ? { reviewStatus: filters.approvedOffer ? "approved" : { not: "approved" } } : {}),
          ...offerDateFilter,
        },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
        select: {
          id: true,
          universityName: true,
          courseName: true,
          courseLevel: true,
          tuitionFeePerYear: true,
          scholarshipAmountPerYear: true,
          scholarshipCoversLivingCost: true,
          privateFundingAmount: true,
          livingCostLocationKey: true,
          livingCostForVisa: true,
          boardingFees: true,
          reviewStatus: true,
          deletedAt: true,
          createdAt: true,
          region: { select: { name: true } },
          student: { select: { id: true, fullName: true, email: true } },
          documents: {
            where: { status: "active", deletedAt: null, documentType: "offer_letter" },
            select: { id: true, originalFilename: true },
          },
        },
      });

      if (offers.length === 0) break;
      cursor = offers[offers.length - 1].id;
      
      let chunk = "";

      for (const offer of offers) {
        let financialGap = 0;
        let financialGapExists = false;

        if (financialRules) {
          try {
            const summary = calculateOfferFinancialSummary(financialRules, {
              countryName:                offer.region.name,
              courseLevel:                offer.courseLevel,
              durationYears:              1,
              tuitionFeePerYear:          offer.tuitionFeePerYear,
              scholarshipAmountPerYear:   offer.scholarshipAmountPerYear ?? undefined,
              scholarshipCoversLivingCost:offer.scholarshipCoversLivingCost,
              privateFundingAmount:       offer.privateFundingAmount,
              privateFundingInterval:     (offer as any).privateFundingInterval,
              livingCostLocationKey:      offer.livingCostLocationKey,
              livingCostForVisa:          offer.livingCostForVisa ?? undefined,
              boardingFees:               offer.boardingFees ?? undefined,
            });
            financialGap = summary.tuitionFeePerYearGap + summary.livingCostGap;
            financialGapExists = financialGap > 0;
          } catch {
            // Leave as 0
          }
        }

        if (filters.financialGapExists !== undefined && filters.financialGapExists !== financialGapExists) continue;
        if (filters.financialGapMin !== undefined && financialGap < filters.financialGapMin) continue;
        if (filters.financialGapMax !== undefined && financialGap > filters.financialGapMax) continue;

        const activeOffer   = !offer.deletedAt && offer.reviewStatus !== "rejected";
        const approvedOffer = offer.reviewStatus === "approved";
        if (filters.activeOffer !== undefined && filters.activeOffer !== activeOffer) continue;

        const offerLetterDoc = offer.documents[0];
        let offerLetterUrl = "";
        if (offerLetterDoc) {
          const expiresAt = new Date(Date.now() + env.CSV_DOC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
          const code = await createShortLink(offerLetterDoc.id, expiresAt);
          offerLetterUrl = `${apiBase}/d/${code}`;
        }

        const row = pickColumns({
          adminId:                 admin.id,
          adminFullName:           admin.fullName,
          adminEmail:              admin.email,
          adminPhone:              admin.phone ?? "",
          regionCode:              adminProfile.region.code,
          regionName:              adminProfile.region.name,
          adminStatus:             adminProfile.status,
          regionalAdminSignupDate: admin.createdAt,
          studentId:               offer.student.id,
          studentName:             offer.student.fullName,
          studentEmail:            offer.student.email,
          offerId:                 offer.id,
          universityName:          offer.universityName,
          courseName:              offer.courseName,
          courseLevel:             offer.courseLevel,
          tuitionFeePerYear:       offer.tuitionFeePerYear,
          scholarshipAmountPerYear:offer.scholarshipAmountPerYear ?? "",
          privateFundingAmount:    offer.privateFundingAmount,
          financialGap,
          financialGapExists,
          offerStatus:             offer.reviewStatus,
          approvedOffer,
          activeOffer,
          offerLetterUrl,
          offerCreatedAt:          offer.createdAt,
        }, job.columns);
        chunk += formatCsvRow(row, headers) + "\n";
        rowCount++;
      }

      await fileHandle.write(chunk);
      totalProcessed += offers.length;
      await onProgress(totalProcessed);

      if (offers.length < BATCH_SIZE) break;
    }
  }

  const stat = await fileHandle.stat();
  await fileHandle.close();
  
  return { filePath: tempFilePath, rowCount, fileSizeBytes: stat.size };
}
