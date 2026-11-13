import { eq } from "drizzle-orm";
import { z } from "zod";
import { marketplaceConnections } from "@/db/schema";
import { parseJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getConnection, getMarketplaceProvider, readCredentials, sealCredentials } from "@/lib/marketplace";

type P = { platform: string };
const Platform = z.enum(["shopee", "lazada"]);

const Body = z.object({
  accountLabel: z.string().trim().max(120).optional().nullable(),
  /** Only fields provided are replaced; an empty string clears a field. Omitted secret = keep existing. */
  credentials: z.record(z.string(), z.string().max(500)).default({}),
  disconnect: z.boolean().optional(),
});

/** Save (encrypted) or clear marketplace credentials. Admin only. */
export const POST = route<P>({ permission: "credentials:manage" }, async ({ req, db, session, params, ip }) => {
  const platform = Platform.parse(params.platform);
  const body = await parseJson(req, Body);
  const conn = await getConnection(db, session.workspaceId, platform);
  if (body.disconnect) {
    await db
      .update(marketplaceConnections)
      .set({ encryptedCredentials: null, status: "disconnected", lastError: null, updatedAt: new Date() })
      .where(eq(marketplaceConnections.id, conn.id));
    await audit(db, { workspaceId: session.workspaceId, userId: session.id, action: "connection.disconnect", entityType: "marketplace_connection", entityId: platform, ip });
    return { ok: true };
  }
  const provider = getMarketplaceProvider(platform);
  const allowed = new Set(provider.credentialFields.map((f) => f.key));
  const merged = { ...readCredentials(conn.encryptedCredentials) };
  for (const [k, v] of Object.entries(body.credentials)) {
    if (!allowed.has(k)) continue;
    if (v === "") delete merged[k];
    else merged[k] = v.trim();
  }
  await db
    .update(marketplaceConnections)
    .set({
      encryptedCredentials: Object.keys(merged).length ? sealCredentials(merged) : null,
      accountLabel: body.accountLabel ?? conn.accountLabel,
      // credentials are not trusted until tested
      status: Object.keys(merged).length ? "permission_pending" : "disconnected",
      updatedAt: new Date(),
    })
    .where(eq(marketplaceConnections.id, conn.id));
  await audit(db, {
    workspaceId: session.workspaceId,
    userId: session.id,
    action: "connection.credentials_update",
    entityType: "marketplace_connection",
    entityId: platform,
    metadata: { fields: Object.keys(body.credentials) },
    ip,
  });
  return { ok: true };
});
