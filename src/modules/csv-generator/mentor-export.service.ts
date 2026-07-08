import { prisma } from "../../db/prisma";
import { formatCsvRow } from "../../shared/csv";
import { createShortLink } from "../documents/csv-doc-token";
import { calculateOfferFinancialSummary, parseFinancialRules } from "../offers/offer-financial";
import { MENTOR_COLUMNS } from "./csv-column-definitions";
import type { CsvJob } from "@prisma/client";
import type { CsvScope } from "./csv-query-builder";
import { buildMentorOfferWhere } from "./csv-query-builder";
import type { MentorCsvBody } from "./csv-generator.validation";
import { env } from "../../config/env";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const BATCH_SIZE = 1000;

function pickColumns(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of columns) {
    out[MENTOR_COLUMNS[col]?.label ?? col] = row[col] ?? "";
  }
  return out;
}

export async function runMentorExport(
  job: CsvJob,
  body: MentorCsvBody,
  scope: CsvScope,
  onProgress: (processed: number) => Promise<void>
): Promise<{ filePath: string; rowCount: number; fileSizeBytes: number }> {

  const appConfig = await prisma.appConfig.findUnique({ where: { key: "offer_financial_rules" } });
  const financialRules = appConfig ? parseFinancialRules(appConfig.value) : null;

  const apiBase = env.FRONTEND_URL.replace(/\/$/, "");
  const where = buildMentorOfferWhere(body, scope);
  
  const tempFilePath = path.join(os.tmpdir(), `csv-mentor-${job.id}.csv`);
  const fileHandle = await fs.open(tempFilePath, 'w');
  
  const headers = job.columns.map((col: string) => MENTOR_COLUMNS[col]?.label ?? col);
  await fileHandle.write(formatCsvRow(Object.fromEntries(headers.map((h: string) => [h, h])), headers) + "\n");
  
  let cursor: string | undefined;
  let processed = 0;
  let rowCount = 0;

  while (true) {
    const jobCheck = await prisma.csvJob.findUnique({ where: { id: job.id }, select: { cancelRequested: true } });
    if (jobCheck?.cancelRequested) {
      await fileHandle.close();
      await fs.unlink(tempFilePath).catch(() => {});
      throw new Error("Cancelled");
    }

    const offers = await prisma.offer.findMany({
      where,
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
        student: { select: { id: true, fullName: true } },
        mentor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            createdAt: true,
            volunteerProfile: { select: { universityAffiliation: true, volunteerStatus: true } },
          },
        },
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
      const mentor = offer.mentor!;
      const vp     = mentor.volunteerProfile;

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
            privateFundingInterval:      (offer as any).privateFundingInterval,
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

      const activeOffer   = !offer.deletedAt && offer.reviewStatus !== "rejected";
      const approvedOffer = offer.reviewStatus === "approved";
      const offerLetterDoc = offer.documents[0];
      let offerLetterUrl = "";
      if (offerLetterDoc) {
        const expiresAt = new Date(Date.now() + env.CSV_DOC_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
        const code = await createShortLink(offerLetterDoc.id, expiresAt);
        offerLetterUrl = `${apiBase}/d/${code}`;
      }

      const row = pickColumns({
        mentorId:                mentor.id,
        mentorFullName:          mentor.fullName,
        email:                   mentor.email,
        phone:                   mentor.phone ?? "",
        universityAffiliation:   vp?.universityAffiliation ?? "",
        volunteerStatus:         vp?.volunteerStatus ?? "",
        mentorSignupDate:        mentor.createdAt,
        country:                 offer.region.name,
        university:              offer.universityName,
        studentId:               offer.student.id,
        studentName:             offer.student.fullName,
        offerId:                 offer.id,
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
    processed += offers.length;
    await onProgress(processed);

    if (offers.length < BATCH_SIZE) break;
  }

  const stat = await fileHandle.stat();
  await fileHandle.close();
  
  return { filePath: tempFilePath, rowCount, fileSizeBytes: stat.size };
}
