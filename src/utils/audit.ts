import { prisma } from "../plugins/db";

type AuditPayload = {
  entityType: "MAP" | "CHARACTER";
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  campaignId: string;
  userId: string;
};

export async function writeAuditLog(payload: AuditPayload) {
  await prisma.auditLog.create({
    data: {
      entityType: payload.entityType,
      entityId: payload.entityId,
      action: payload.action,
      before: payload.before ?? null,
      after: payload.after ?? null,
      campaignId: payload.campaignId,
      userId: payload.userId,
    },
  });
}
