import { env } from "../../config/env";
import { uploadToStorage, getSignedStorageUrl, deleteFromStorage } from "../../shared/storage";
import type { CsvDataset } from "@prisma/client";

export function buildCsvStorageKey(jobId: string, dataset: CsvDataset): string {
  const now  = new Date();
  const yyyy = now.getUTCFullYear();
  const mm   = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `csv-exports/${yyyy}/${mm}/${dataset}/${jobId}.csv`;
}

/**
 * Upload the finished CSV buffer to R2.
 * Returns the storage key and bucket name so they can be saved on the CsvJob record.
 */
export async function uploadCsv(
  buffer: Buffer,
  jobId: string,
  dataset: CsvDataset
): Promise<{ key: string; bucket: string }> {
  const key    = buildCsvStorageKey(jobId, dataset);
  const folder = key.substring(0, key.lastIndexOf("/"));
  return uploadToStorage(buffer, `${jobId}.csv`, "text/csv; charset=utf-8", folder);
}

/**
 * Generate a fresh time-limited signed download URL for a completed CSV.
 * TTL is controlled by the CSV_SIGNED_URL_TTL_DAYS env var (default 30 days).
 */
export async function getCsvDownloadUrl(key: string, bucket: string): Promise<string | null> {
  const ttlSeconds = env.CSV_SIGNED_URL_TTL_DAYS * 24 * 60 * 60;
  return getSignedStorageUrl(key, bucket, ttlSeconds);
}

/** Remove the CSV object from R2. Returns false if deletion fails. */
export async function deleteCsvFromStorage(key: string, bucket: string): Promise<boolean> {
  return deleteFromStorage(key, bucket);
}
