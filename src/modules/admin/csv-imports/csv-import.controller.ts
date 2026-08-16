import { asyncHandler, sendSuccess, ApiError } from "../../../shared/http";
import { recordAuditLog } from "../../../shared/audit";
import { importCsvRows, parseCsvRows } from "./csv-import.service";

const datasets = ["universities", "regions"] as const;
type Dataset = (typeof datasets)[number];

function resolveDataset(raw: string): Dataset {
  if (!datasets.includes(raw as Dataset)) {
    throw new ApiError(400, "Invalid dataset");
  }
  return raw as Dataset;
}

const entityTypeFor = (dataset: Dataset) => (dataset === "universities" ? "University" : "Region");

export const uploadCsvHandler = asyncHandler(async (req, res) => {
  const dataset = resolveDataset(req.params.dataset);

  if (!req.file) {
    throw new ApiError(400, "No CSV file uploaded");
  }

  const rows = parseCsvRows(req.file.buffer);
  const { results, summary } = await importCsvRows(dataset, rows);

  // Counts only. The per-row results go back in the response for the admin to read now;
  // storing every row here is what pushed the audit document past MongoDB's 16MB cap.
  await recordAuditLog({
    actorUserId: req.authUser!.id,
    action: "csv_import",
    entityType: entityTypeFor(dataset),
    metadata: summary,
    ipAddress: req.ip,
    userAgent: req.get("user-agent")
  });

  sendSuccess(res, { summary, results });
});
