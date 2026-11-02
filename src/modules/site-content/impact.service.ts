import type { ImpactStat } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../shared/http";
import { recordAuditLog } from "../../shared/audit";
import type { Actor } from "./request-actor";
import type { createImpactStatSchema, updateImpactStatSchema } from "./impact.validation";

function toDto(stat: ImpactStat) {
  return {
    id: stat.id,
    label: stat.label,
    value: stat.value,
    suffix: stat.suffix,
    icon: stat.icon,
    asOf: stat.asOf,
    isActive: stat.isActive,
    sortOrder: stat.sortOrder
  };
}

/** Public shape: only what the website renders. */
function toPublicDto(stat: ImpactStat) {
  return {
    id: stat.id,
    label: stat.label,
    value: stat.value,
    suffix: stat.suffix,
    icon: stat.icon,
    asOf: stat.asOf
  };
}

export async function listPublicImpactStats() {
  const stats = await prisma.impactStat.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  return stats.map(toPublicDto);
}

export async function listAdminImpactStats() {
  const stats = await prisma.impactStat.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
  });
  return stats.map(toDto);
}

async function findOrThrow(id: string) {
  const stat = await prisma.impactStat.findFirst({ where: { id, deletedAt: null } });
  if (!stat) throw new ApiError(404, "Impact stat not found");
  return stat;
}

export async function createImpactStat(data: z.infer<typeof createImpactStatSchema>, actor: Actor) {
  const last = await prisma.impactStat.findFirst({
    where: { deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true }
  });

  const stat = await prisma.impactStat.create({
    // deletedAt is explicit: on MongoDB a missing field does not match `deletedAt: null`.
    data: { ...data, sortOrder: (last?.sortOrder ?? -1) + 1, deletedAt: null }
  });

  await recordAuditLog({ ...actor, action: "impact_stat_created", entityType: "impact_stat", entityId: stat.id });
  return toDto(stat);
}

export async function updateImpactStat(id: string, data: z.infer<typeof updateImpactStatSchema>, actor: Actor) {
  await findOrThrow(id);
  const stat = await prisma.impactStat.update({ where: { id }, data });
  await recordAuditLog({
    ...actor,
    action: "impact_stat_updated",
    entityType: "impact_stat",
    entityId: id,
    metadata: { fields: Object.keys(data) }
  });
  return toDto(stat);
}

export async function deleteImpactStat(id: string, actor: Actor) {
  await findOrThrow(id);
  await prisma.impactStat.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await recordAuditLog({ ...actor, action: "impact_stat_deleted", entityType: "impact_stat", entityId: id });
}

export async function reorderImpactStats(ids: string[], actor: Actor) {
  const existing = await prisma.impactStat.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  if (existing.length !== new Set(ids).size) {
    throw new ApiError(400, "One or more impact stats do not exist");
  }

  await prisma.$transaction(ids.map((id, index) => prisma.impactStat.update({ where: { id }, data: { sortOrder: index } })));
  await recordAuditLog({ ...actor, action: "impact_stats_reordered", entityType: "impact_stat" });
  return listAdminImpactStats();
}
