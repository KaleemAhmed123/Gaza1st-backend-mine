/**
 * csv-doc-token.ts
 *
 * Generates and verifies short-lived tokens that allow unauthenticated
 * direct download of offer letter documents embedded in exported CSVs.
 *
 * Flow:
 *   1. At CSV generation time: generateCsvDocToken(docId) → embed URL in CSV
 *   2. When user clicks the link in the CSV: GET /api/documents/:docId/signed-download?token=<token>
 *   3. Endpoint verifies token, fetches a fresh R2 presigned URL, 302-redirects → browser downloads file
 *
 * Uses deterministic AES-256-CBC encryption to output extremely compact
 * base64url tokens (22 characters) to keep CSV link lengths human-readable.
 */

import crypto from "crypto";
import { env } from "../../config/env";

// Derives a 32-byte key from the JWT_ACCESS_SECRET
const KEY = crypto.createHash("sha256").update(env.JWT_ACCESS_SECRET).digest();

/**
 * Sign/encrypt a token for a specific document ID.
 * TTL is CSV_DOC_LINK_TTL_DAYS (default 30 days) — matches CSV expiry.
 */
export function generateCsvDocToken(docId: string): string {
  // docId is a 24-character hex string (12 bytes)
  const docIdBuf = Buffer.from(docId, "hex");
  if (docIdBuf.length !== 12) {
    throw new Error("Invalid docId length");
  }

  // expiresAt is Unix timestamp in seconds (4 bytes)
  const expiresAt = Math.floor(Date.now() / 1000) + env.CSV_DOC_LINK_TTL_DAYS * 24 * 60 * 60;
  const expiresAtBuf = Buffer.alloc(4);
  expiresAtBuf.writeUInt32BE(expiresAt);

  // Combine into a 16-byte buffer
  const plain = Buffer.concat([docIdBuf, expiresAtBuf]);

  // Generate a random 16-byte IV per token
  const IV = crypto.randomBytes(16);

  // Encrypt with AES-256-CBC (no padding since input is exactly 16 bytes)
  const cipher = crypto.createCipheriv("aes-256-cbc", KEY, IV);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);

  // Convert to base64url (43 characters)
  return Buffer.concat([IV, encrypted]).toString("base64url");
}

/**
 * Verify a CSV doc token.
 * Throws if token is invalid, expired, wrong purpose, or docId mismatch.
 */
export function verifyCsvDocToken(token: string, expectedDocId: string): void {
  try {
    const tokenBuf = Buffer.from(token, "base64url");
    if (tokenBuf.length !== 32) {
      throw new Error("Invalid token length");
    }

    const IV = tokenBuf.subarray(0, 16);
    const encrypted = tokenBuf.subarray(16);

    const decipher = crypto.createDecipheriv("aes-256-cbc", KEY, IV);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const docId = decrypted.subarray(0, 12).toString("hex");
    const expiresAt = decrypted.readUInt32BE(12);

    if (docId !== expectedDocId) {
      throw new Error("Token document ID mismatch");
    }

    if (Math.floor(Date.now() / 1000) > expiresAt) {
      throw new Error("Token has expired");
    }
  } catch (err) {
    throw new Error("Invalid or expired document token");
  }
}

import { prisma } from "../../db/prisma";

/**
 * Creates a unique 6-character short link record for direct document downloads.
 */
export async function createShortLink(docId: string, expiresAt: Date): Promise<string> {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  for (let attempt = 0; attempt < 10; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    try {
      await prisma.shortLink.create({
        data: {
          code,
          docId,
          expiresAt,
        },
      });
      return code;
    } catch (err: any) {
      if (err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to generate unique short link code");
}


