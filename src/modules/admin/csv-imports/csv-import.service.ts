import { prisma } from "../../../db/prisma";
import { parse } from "csv-parse/sync";
import { ApiError } from "../../../shared/http";

export type CsvImportResult = {
  name: string;
  region: string;
  success: boolean;
  message: string;
};

export type CsvImportSummary = {
  totalRows: number;
  successfulRows: number;
  failedRows: number;
};

// ponytail: imports run inline on the request, so the row count is capped rather than
// queued. Regions and universities are master data — a few hundred rows in practice.
// If a real import ever exceeds this, move to a job queue instead of raising the cap.
export const maxCsvImportRows = 5000;

/**
 * A leading row is treated as a header when its first cell mentions "name". Same rule the
 * admin-facing template uses; kept in one place so the count and the import can't disagree.
 */
function stripHeader(records: string[][]): string[][] {
  const first = records[0]?.[0];
  return typeof first === "string" && first.toLowerCase().includes("name")
    ? records.slice(1)
    : records;
}

export function parseCsvRows(fileBuffer: Buffer): string[][] {
  let records: string[][];
  try {
    records = parse(fileBuffer, { skip_empty_lines: true });
  } catch {
    throw new ApiError(400, "Failed to parse CSV file");
  }

  const rows = stripHeader(records);
  if (rows.length === 0) {
    throw new ApiError(400, "CSV file is empty");
  }
  if (rows.length > maxCsvImportRows) {
    throw new ApiError(
      400,
      `CSV has ${rows.length} rows, which is over the ${maxCsvImportRows} row limit. Split the file and import it in parts.`
    );
  }

  return rows;
}

async function importRegionRow(row: string[]): Promise<CsvImportResult> {
  const name = row[0]?.trim();
  const code = row[1]?.trim();

  if (!name || !code) {
    return { name: name || "Unknown", region: "-", success: false, message: "Missing name or code" };
  }

  const existing = await prisma.region.findFirst({
    where: {
      OR: [
        { name: { equals: name, mode: "insensitive" } },
        { code: { equals: code, mode: "insensitive" } }
      ]
    }
  });

  if (existing) {
    return { name, region: "-", success: false, message: "Duplicate region name or code" };
  }

  await prisma.region.create({ data: { name, code, isActive: true } });
  return { name, region: "-", success: true, message: "Added" };
}

async function importUniversityRow(row: string[]): Promise<CsvImportResult> {
  const name = row[0]?.trim();
  const regionName = row[1]?.trim();
  const regionCode = row[2]?.trim();
  const regionLabel = regionName || regionCode || "-";

  if (!name || (!regionName && !regionCode)) {
    return { name: name || "Unknown", region: regionLabel, success: false, message: "Missing name or region" };
  }

  const regionMatches = [
    regionName ? { name: { equals: regionName, mode: "insensitive" as const } } : null,
    regionCode ? { code: { equals: regionCode, mode: "insensitive" as const } } : null
  ].filter((match): match is NonNullable<typeof match> => match !== null);

  const region = await prisma.region.findFirst({ where: { OR: regionMatches } });

  if (!region) {
    return { name, region: regionLabel, success: false, message: "Region not found" };
  }

  const existing = await prisma.university.findFirst({
    where: { regionId: region.id, name: { equals: name, mode: "insensitive" } }
  });

  if (existing) {
    return { name, region: region.name, success: false, message: "Duplicate university in this region" };
  }

  await prisma.university.create({ data: { name, regionId: region.id, isActive: true } });
  return { name, region: region.name, success: true, message: "Added" };
}

/**
 * Rows are independent and applied one at a time, deliberately not wrapped in a transaction:
 * a CSV with three bad rows should still import the good ones and report the rest, rather
 * than rolling the whole file back.
 */
export async function importCsvRows(
  dataset: "universities" | "regions",
  rows: string[][]
): Promise<{ results: CsvImportResult[]; summary: CsvImportSummary }> {
  const results: CsvImportResult[] = [];

  for (const row of rows) {
    results.push(
      dataset === "regions" ? await importRegionRow(row) : await importUniversityRow(row)
    );
  }

  const successfulRows = results.filter((r) => r.success).length;

  return {
    results,
    summary: {
      totalRows: results.length,
      successfulRows,
      failedRows: results.length - successfulRows
    }
  };
}
