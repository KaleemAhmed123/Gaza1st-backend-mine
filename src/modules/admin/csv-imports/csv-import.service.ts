import { prisma } from "../../../db/prisma";
import { parse } from "csv-parse/sync";
import { createNotification } from "../../notifications/notification.service";

export async function processCsvImport(
  auditLogId: string,
  dataset: "universities" | "regions",
  fileBuffer: Buffer
) {
  try {
    const records = parse(fileBuffer, { skip_empty_lines: true });
    if (!records || records.length === 0) {
      throw new Error("CSV file is empty or invalid.");
    }

    let startIndex = 0;
    if (typeof records[0][0] === "string" && records[0][0].toLowerCase().includes("name")) {
      startIndex = 1;
    }

    const recordsToProcess = records.slice(startIndex);
    const totalRows = recordsToProcess.length;
    let processedRows = 0;
    let successfulRows = 0;
    let failedRows = 0;
    const finalResults: Array<{ name: string; region: string; success: boolean; message: string }> = [];

    const BATCH_SIZE = 50;

    for (let i = 0; i < recordsToProcess.length; i += BATCH_SIZE) {
      const batch = recordsToProcess.slice(i, i + BATCH_SIZE);
      const batchResults: typeof finalResults = [];

      await prisma.$transaction(async (tx) => {
        for (const row of batch) {
          if (dataset === "regions") {
            const name = row[0]?.trim();
            const code = row[1]?.trim();

            if (!name || !code) {
              batchResults.push({ name: name || "Unknown", region: "-", success: false, message: "Missing name or code" });
              continue;
            }

            const existing = await tx.region.findFirst({
              where: {
                OR: [
                  { name: { equals: name, mode: "insensitive" } },
                  { code: { equals: code, mode: "insensitive" } }
                ]
              }
            });

            if (existing) {
              batchResults.push({ name, region: "-", success: false, message: "Duplicate region name or code" });
            } else {
              await tx.region.create({
                data: { name, code, isActive: true }
              });
              batchResults.push({ name, region: "-", success: true, message: "Added" });
            }
          } else if (dataset === "universities") {
            const name = row[0]?.trim();
            const regionName = row[1]?.trim();
            const regionCode = row[2]?.trim();

            if (!name || (!regionName && !regionCode)) {
              batchResults.push({ name: name || "Unknown", region: regionName || regionCode || "-", success: false, message: "Missing name or region" });
              continue;
            }

            const region = await tx.region.findFirst({
              where: {
                OR: [
                  regionName ? { name: { equals: regionName, mode: "insensitive" } } : {},
                  regionCode ? { code: { equals: regionCode, mode: "insensitive" } } : {}
                ].filter(x => Object.keys(x).length > 0)
              }
            });

            if (!region) {
              batchResults.push({ name, region: regionName || regionCode || "-", success: false, message: "Region not found" });
              continue;
            }

            const existingUni = await tx.university.findFirst({
              where: {
                regionId: region.id,
                name: { equals: name, mode: "insensitive" }
              }
            });

            if (existingUni) {
              batchResults.push({ name, region: region.name, success: false, message: "Duplicate university in this region" });
            } else {
              await tx.university.create({
                data: { name, regionId: region.id, isActive: true }
              });
              batchResults.push({ name, region: region.name, success: true, message: "Added" });
            }
          }
        }
      });

      finalResults.push(...batchResults);
      processedRows += batch.length;
      
      for (const r of batchResults) {
        if (r.success) successfulRows++;
        else failedRows++;
      }

      await prisma.auditLog.update({
        where: { id: auditLogId },
        data: {
          metadata: {
            status: "processing",
            totalRows,
            processedRows,
            successfulRows,
            failedRows,
            results: finalResults
          }
        }
      });
    }

    const auditLog = await prisma.auditLog.update({
      where: { id: auditLogId },
      data: {
        metadata: {
          status: "completed",
          totalRows,
          processedRows,
          successfulRows,
          failedRows,
          results: finalResults
        }
      }
    });

    if (auditLog.actorUserId) {
      await createNotification({
        userId: auditLog.actorUserId,
        type: "csv_import_completed",
        title: "CSV Import Completed",
        body: `Your ${dataset} CSV import has finished processing.`,
        link: "/admin/settings"
      });
    }
  } catch (error: any) {
    console.error("CSV Import Error:", error);
    const audit = await prisma.auditLog.findUnique({ where: { id: auditLogId } });
    const meta = (audit?.metadata as any) || {};

    const failedLog = await prisma.auditLog.update({
      where: { id: auditLogId },
      data: {
        metadata: {
          ...meta,
          status: "failed",
          errorMessage: error.message || "Unknown error occurred"
        }
      }
    });

    if (failedLog.actorUserId) {
      await createNotification({
        userId: failedLog.actorUserId,
        type: "csv_import_failed",
        title: "CSV Import Failed",
        body: `Your ${dataset} CSV import failed to process.`,
        link: "/admin/settings"
      });
    }
  }
}
