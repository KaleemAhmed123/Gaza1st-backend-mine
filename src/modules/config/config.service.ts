import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import type {
  createConfigOptionSchema,
  createRegionSchema,
  createUniversitySchema,
  listUniversitiesQuerySchema,
  updateConfigOptionSchema,
  updateRegionSchema,
  updateUniversitySchema
} from "./config.validation";
import type { z } from "zod";

type CreateConfigOptionInput = z.infer<typeof createConfigOptionSchema>;
type UpdateConfigOptionInput = z.infer<typeof updateConfigOptionSchema>;
type CreateRegionInput = z.infer<typeof createRegionSchema>;
type UpdateRegionInput = z.infer<typeof updateRegionSchema>;
type CreateUniversityInput = z.infer<typeof createUniversitySchema>;
type UpdateUniversityInput = z.infer<typeof updateUniversitySchema>;
type ListUniversitiesQuery = z.infer<typeof listUniversitiesQuerySchema>;

export async function listRegions() {
  return prisma.region.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { name: "asc" }
  });
}

export async function listAllRegions() {
  return prisma.region.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" }
  });
}

export async function listConfigOptions(groupKey: string) {
  return prisma.configOption.findMany({
    where: { groupKey, isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { labelEn: "asc" }]
  });
}

export async function listUniversities(query: ListUniversitiesQuery) {
  return prisma.university.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      region: { isActive: true, deletedAt: null },
      ...(query.regionId ? { regionId: query.regionId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {})
    },
    include: { region: true },
    orderBy: { name: "asc" },
    take: 50
  });
}

export async function listAllUniversities(query: ListUniversitiesQuery) {
  return prisma.university.findMany({
    where: {
      deletedAt: null,
      ...(query.regionId ? { regionId: query.regionId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {})
    },
    include: { region: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }]
  });
}

export async function createConfigOption(input: CreateConfigOptionInput) {
  return prisma.configOption.create({
    data: {
      groupKey: input.groupKey,
      value: input.value,
      labelEn: input.labelEn,
      labelAr: input.labelAr,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      deletedAt: null
    }
  });
}

export async function updateConfigOption(id: string, input: UpdateConfigOptionInput) {
  await ensureConfigOption(id);

  return prisma.configOption.update({
    where: { id },
    data: {
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue | undefined
    }
  });
}

export async function deactivateConfigOption(id: string) {
  await ensureConfigOption(id);

  return prisma.configOption.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() }
  });
}

export async function createRegion(input: CreateRegionInput) {
  return prisma.region.create({
    data: {
      code: input.code,
      name: input.name,
      isActive: input.isActive,
      deletedAt: null
    }
  });
}

export async function updateRegion(id: string, input: UpdateRegionInput) {
  await ensureRegion(id);

  return prisma.region.update({
    where: { id },
    data: input
  });
}

export async function deactivateRegion(id: string) {
  await ensureRegion(id);

  return prisma.region.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() }
  });
}

export async function createUniversity(input: CreateUniversityInput) {
  await ensureRegion(input.regionId);

  return prisma.university.create({
    data: {
      regionId: input.regionId,
      name: input.name,
      city: input.city,
      logoUrl: input.logoUrl,
      isLondon: input.isLondon,
      isActive: input.isActive,
      deletedAt: null
    },
    include: { region: true }
  });
}

export async function updateUniversity(id: string, input: UpdateUniversityInput) {
  await ensureUniversity(id);

  if (input.regionId) {
    await ensureRegion(input.regionId);
  }

  return prisma.university.update({
    where: { id },
    data: input,
    include: { region: true }
  });
}

export async function deactivateUniversity(id: string) {
  await ensureUniversity(id);

  return prisma.university.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
    include: { region: true }
  });
}

async function ensureConfigOption(id: string) {
  const option = await prisma.configOption.findFirst({ where: { id, deletedAt: null } });
  if (!option) {
    throw new ApiError(404, "Config option not found");
  }
}

async function ensureRegion(id: string) {
  const region = await prisma.region.findFirst({ where: { id, deletedAt: null } });
  if (!region) {
    throw new ApiError(404, "Region not found");
  }
}

async function ensureUniversity(id: string) {
  const university = await prisma.university.findFirst({ where: { id, deletedAt: null } });
  if (!university) {
    throw new ApiError(404, "University not found");
  }
}
