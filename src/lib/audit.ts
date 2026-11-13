import type { Db } from "@/db/client";
import { auditLogs } from "@/db/schema";

export async function audit(
  db: Db,
  entry: {
    workspaceId: string;
    userId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  },
) {
  await db.insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    ip: entry.ip ?? null,
  });
}
