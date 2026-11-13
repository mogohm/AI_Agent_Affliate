import { eq } from "drizzle-orm";
import { z } from "zod";
import { marketplaceConnections } from "@/db/schema";
import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getConnection, getMarketplaceProvider, readCredentials } from "@/lib/marketplace";

/** Test the stored credentials against the official API and record the resulting status. */
export const POST = route<{ platform: string }>({ permission: "credentials:manage" }, async ({ db, session, params, ip }) => {
  const platform = z.enum(["shopee", "lazada"]).parse(params.platform);
  const conn = await getConnection(db, session.workspaceId, platform);
  const result = await getMarketplaceProvider(platform).testConnection(readCredentials(conn.encryptedCredentials));
  await db
    .update(marketplaceConnections)
    .set({
      status: result.status,
      lastCheckedAt: new Date(),
      lastError: result.status === "connected" ? null : result.message,
      rateLimitResetAt: result.rateLimitResetAt ?? null,
      updatedAt: new Date(),
    })
    .where(eq(marketplaceConnections.id, conn.id));
  await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "connection.test", entityType: "marketplace_connection", entityId: platform, metadata: { status: result.status }, ip });
  return result;
});
