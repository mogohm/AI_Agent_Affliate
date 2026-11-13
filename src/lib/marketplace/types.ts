import type { ProductInput } from "@/lib/catalog/service";

export type MarketplaceCredentials = { appId?: string; secret?: string; endpoint?: string; [k: string]: string | undefined };

export type ConnectionTestResult = {
  status: "connected" | "permission_pending" | "disconnected" | "sync_failed" | "rate_limited";
  message: string;
  rateLimitResetAt?: Date | null;
};

export type FetchOffersQuery = { keyword?: string; limit?: number; cursor?: string | null };

export type FetchOffersResult = { items: ProductInput[]; nextCursor: string | null };

/**
 * Versioned marketplace adapter. Implementations must only call officially authorised endpoints
 * with credentials supplied by the workspace — never scrape.
 */
export interface MarketplaceProvider {
  readonly platform: "shopee" | "lazada";
  readonly version: string;
  readonly displayName: string;
  readonly capabilities: { productOffers: boolean; commissionRates: boolean; conversionReports: boolean; linkGeneration: boolean };
  /** Human-readable requirements shown in Settings. */
  readonly requirements: string[];
  readonly credentialFields: { key: string; label: string; secret: boolean }[];
  testConnection(creds: MarketplaceCredentials): Promise<ConnectionTestResult>;
  fetchOffers(creds: MarketplaceCredentials, query: FetchOffersQuery): Promise<FetchOffersResult>;
}

export class MarketplaceError extends Error {
  constructor(
    message: string,
    public kind: "auth" | "rate_limited" | "permission" | "network" | "invalid_response",
  ) {
    super(message);
  }
}
