import { desc, eq } from "drizzle-orm";
import { ingestionRuns } from "@/db/schema";
import { route } from "@/lib/api";
import { describeCredentials, getConnection, getMarketplaceProvider, readCredentials } from "@/lib/marketplace";

/** Connection status for each marketplace. Secrets are only ever returned masked. */
export const GET = route({ permission: "settings:read" }, async ({ db, session }) => {
  const items = [];
  for (const platform of ["shopee", "lazada"] as const) {
    const c = await getConnection(db, session.workspaceId, platform);
    const provider = getMarketplaceProvider(platform);
    const creds = readCredentials(c.encryptedCredentials);
    items.push({
      platform,
      displayName: provider.displayName,
      adapterVersion: provider.version,
      status: c.status,
      accountLabel: c.accountLabel,
      lastSyncAt: c.lastSyncAt,
      lastCheckedAt: c.lastCheckedAt,
      lastError: c.lastError,
      rateLimitResetAt: c.rateLimitResetAt,
      capabilities: provider.capabilities,
      requirements: provider.requirements,
      credentialFields: provider.credentialFields,
      credentials: describeCredentials(provider, creds),
      hasCredentials: !!c.encryptedCredentials,
    });
  }
  const recentImports = await db
    .select({ id: ingestionRuns.id, fileName: ingestionRuns.fileName, status: ingestionRuns.status, totalRows: ingestionRuns.totalRows, createdAt: ingestionRuns.createdAt })
    .from(ingestionRuns)
    .where(eq(ingestionRuns.workspaceId, session.workspaceId))
    .orderBy(desc(ingestionRuns.createdAt))
    .limit(5);
  return { items, recentImports };
});
