/**
 * Self-check for CSV import parsing. Run: npx tsx scripts/test-csv-import.ts
 *
 * Covers parseCsvRows only — header detection, the empty case, and the row cap. These are
 * the branches that decide what gets written to the database, and getting the header rule
 * wrong silently imports a row called "name" or drops a real one.
 */
import assert from "assert";

// The service reaches config/env through db/prisma, which validates on import. These are the
// only three required vars; parsing never touches the database, so placeholders are enough.
process.env.DATABASE_URL ||= "mongodb://localhost:27017/placeholder";
process.env.JWT_ACCESS_SECRET ||= "x".repeat(32);
process.env.JWT_REFRESH_SECRET ||= "x".repeat(32);

const buf = (s: string) => Buffer.from(s, "utf8");

async function main() {
  const { maxCsvImportRows, parseCsvRows } = await import(
    "../src/modules/admin/csv-imports/csv-import.service"
  );

  // Header row is dropped when the first cell mentions "name".
  assert.deepStrictEqual(parseCsvRows(buf("Name,Code\nGaza,GZ\nRafah,RF")), [
    ["Gaza", "GZ"],
    ["Rafah", "RF"]
  ]);

  // No header means no row is lost.
  assert.deepStrictEqual(parseCsvRows(buf("Gaza,GZ\nRafah,RF")), [
    ["Gaza", "GZ"],
    ["Rafah", "RF"]
  ]);

  // A single data row without a header survives.
  assert.deepStrictEqual(parseCsvRows(buf("Gaza,GZ")), [["Gaza", "GZ"]]);

  // Blank lines are skipped rather than becoming empty rows.
  assert.deepStrictEqual(parseCsvRows(buf("Gaza,GZ\n\nRafah,RF\n")), [
    ["Gaza", "GZ"],
    ["Rafah", "RF"]
  ]);

  // Empty file, and header-only file, both rejected rather than reported as a 0-row success.
  assert.throws(() => parseCsvRows(buf("")), /empty/i);
  assert.throws(() => parseCsvRows(buf("Name,Code")), /empty/i);

  // Over the cap is rejected, at the cap is accepted.
  const row = "Gaza,GZ\n";
  assert.throws(() => parseCsvRows(buf(row.repeat(maxCsvImportRows + 1))), /row limit/i);
  assert.strictEqual(parseCsvRows(buf(row.repeat(maxCsvImportRows))).length, maxCsvImportRows);

  // Malformed CSV surfaces as a 400, not an unhandled parser crash.
  assert.throws(() => parseCsvRows(buf('Gaza,"unterminated')), /Failed to parse/i);

  console.log("csv import parsing: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
