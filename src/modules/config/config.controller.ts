import path from "path";
import { pipeline } from "stream";
import { ApiError, asyncHandler, sendSuccess } from "../../shared/http";
import { uploadToStorage, getObjectStreamFromStorage } from "../../shared/storage";
import { env } from "../../config/env";
import {
  createConfigOption,
  createRegion,
  createUniversity,
  deactivateConfigOption,
  deactivateRegion,
  deactivateUniversity,
  listAllRegions,
  listAllUniversities,
  listConfigOptions,
  listRegions,
  listUniversities,
  updateConfigOption,
  updateRegion,
  updateUniversity
} from "./config.service";
import {
  createConfigOptionSchema,
  createRegionSchema,
  createUniversitySchema,
  listOptionsQuerySchema,
  listUniversitiesQuerySchema,
  updateConfigOptionSchema,
  updateRegionSchema,
  updateUniversitySchema
} from "./config.validation";

export const listRegionsHandler = asyncHandler(async (_req, res) => {
  const regions = await listRegions();
  sendSuccess(res, { regions });
});

export const listConfigOptionsHandler = asyncHandler(async (req, res) => {
  const query = listOptionsQuerySchema.parse(req.query);
  const options = await listConfigOptions(query.groupKey);
  sendSuccess(res, { options });
});

export const listUniversitiesHandler = asyncHandler(async (req, res) => {
  const query = listUniversitiesQuerySchema.parse(req.query);
  const universities = await listUniversities(query);
  sendSuccess(res, { universities });
});

export const listAllRegionsAdminHandler = asyncHandler(async (_req, res) => {
  const regions = await listAllRegions();
  sendSuccess(res, { regions });
});

export const listAllUniversitiesAdminHandler = asyncHandler(async (req, res) => {
  const query = listUniversitiesQuerySchema.parse(req.query);
  const universities = await listAllUniversities(query);
  sendSuccess(res, { universities });
});

export const createConfigOptionHandler = asyncHandler(async (req, res) => {
  const input = createConfigOptionSchema.parse(req.body);
  const option = await createConfigOption(input);
  sendSuccess(res, { option }, 201);
});

export const updateConfigOptionHandler = asyncHandler(async (req, res) => {
  const input = updateConfigOptionSchema.parse(req.body);
  const option = await updateConfigOption(req.params.id, input);
  sendSuccess(res, { option });
});

export const deactivateConfigOptionHandler = asyncHandler(async (req, res) => {
  const option = await deactivateConfigOption(req.params.id);
  sendSuccess(res, { option });
});

export const createRegionHandler = asyncHandler(async (req, res) => {
  const input = createRegionSchema.parse(req.body);
  const region = await createRegion(input);
  sendSuccess(res, { region }, 201);
});

export const updateRegionHandler = asyncHandler(async (req, res) => {
  const input = updateRegionSchema.parse(req.body);
  const region = await updateRegion(req.params.id, input);
  sendSuccess(res, { region });
});

export const deactivateRegionHandler = asyncHandler(async (req, res) => {
  const region = await deactivateRegion(req.params.id);
  sendSuccess(res, { region });
});

export const createUniversityHandler = asyncHandler(async (req, res) => {
  const input = createUniversitySchema.parse(req.body);
  const university = await createUniversity(input);
  sendSuccess(res, { university }, 201);
});

export const updateUniversityHandler = asyncHandler(async (req, res) => {
  const input = updateUniversitySchema.parse(req.body);
  const university = await updateUniversity(req.params.id, input);
  sendSuccess(res, { university });
});

export const deactivateUniversityHandler = asyncHandler(async (req, res) => {
  const university = await deactivateUniversity(req.params.id);
  sendSuccess(res, { university });
});

export const uploadUniversityLogoHandler = asyncHandler(async (req, res) => {
  const file = (req.files as any)?.file?.[0] || (req.files as any)?.logo?.[0] || req.file;
  if (!file) {
    throw new ApiError(400, "No logo file provided");
  }

  const { key } = await uploadToStorage(
    file.buffer,
    file.originalname,
    file.mimetype,
    "university-logos"
  );

  const filename = path.basename(key);
  const logoUrl = `/api/config/universities/logo/${filename}`;

  sendSuccess(res, { url: logoUrl, filename });
});

export const getUniversityLogoHandler = asyncHandler(async (req, res, next) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
    throw new ApiError(400, "Invalid logo filename");
  }

  const key = `university-logos/${filename}`;
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif"
  };
  const contentType = mimeTypes[ext] || "application/octet-stream";

  const bucket = env.R2_BUCKET_NAME || "gaza40-documents";
  const s3Stream = await getObjectStreamFromStorage(key, bucket);
  if (s3Stream) {
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    pipeline(s3Stream, res, (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    });
    return;
  }

  // Local filesystem fallback
  const localPath = path.join(process.cwd(), key);
  try {
    const fs = await import("fs/promises");
    await fs.access(localPath);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(localPath);
  } catch {
    throw new ApiError(404, "University logo not found");
  }
});
