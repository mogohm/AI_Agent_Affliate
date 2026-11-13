import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { marketplaceConnections } from "@/db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { lazadaProvider } from "./lazada";
import { shopeeProvider } from "./shopee";
import type { MarketplaceCredentials, MarketplaceProvider } from "./types";

const g = globalThis as unknown as { __marketplaceOverrides?: Partial<Record<string, MarketplaceProvider>> };

export function getMarketplaceProvider(platform: "shopee" | "lazada"): MarketplaceProvider {
  return g.__marketplaceOverrides?.[platform] ?? (platform === "shopee" ? shopeeProvider : lazadaProvider);
}

/** Tests only. */
export function __setMarketplaceProvider(platform: "shopee" | "lazada", p: MarketplaceProvider | undefined) {
  g.__marketplaceOverrides ??= {};
  g.__marketplaceOverrides[platform] = p;
}

export async function getConnection(db: Db, workspaceId: string, platform: "shopee" | "lazada") {
  const [row] = await db
    .select()
    .from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.platform, platform)));
  if (row) return row;
  const [created] = await db.insert(marketplaceConnections).values({ workspaceId, platform, status: "disconnected" }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(marketplaceConnections)
    .where(and(eq(marketplaceConnections.workspaceId, workspaceId), eq(marketplaceConnections.platform, platform)));
  return again;
}

export function readCredentials(encrypted: string | null): MarketplaceCredentials {
  if (!encrypted) return {};
  try {
    return JSON.parse(decryptSecret(encrypted)) as MarketplaceCredentials;
  } catch {
    return {};
  }
}

export function sealCredentials(creds: MarketplaceCredentials): string {
  return encryptSecret(JSON.stringify(creds));
}

/** Client-safe description: secret fields masked, never returned in clear. */
export function describeCredentials(provider: MarketplaceProvider, creds: MarketplaceCredentials) {
  return Object.fromEntries(
    provider.credentialFields.map((f) => [f.key, f.secret ? maskSecret(creds[f.key]) : (creds[f.key] ?? null)]),
  ) as Record<string, string | null>;
}

export type { MarketplaceProvider } from "./types";
