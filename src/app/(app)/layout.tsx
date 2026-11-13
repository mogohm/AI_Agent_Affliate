import { cookies } from "next/headers";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/db/client";
import { jobs, marketplaceConnections, products, videoProjects } from "@/db/schema";
import { requirePageSession } from "@/lib/auth/session";
import { getAiContext } from "@/lib/ai/context";
import { THEME_COOKIE, type ThemeKey } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const db = await getDb();
  const ws = session.workspaceId;
  const [[p], [j], [r], conns, ai] = await Promise.all([
    db.select({ n: count() }).from(products).where(and(eq(products.workspaceId, ws), isNull(products.deletedAt))),
    db.select({ n: count() }).from(jobs).where(and(eq(jobs.workspaceId, ws), inArray(jobs.status, ["queued", "running"]))),
    db.select({ n: count() }).from(videoProjects).where(and(eq(videoProjects.workspaceId, ws), eq(videoProjects.status, "quality_review"))),
    db.select().from(marketplaceConnections).where(eq(marketplaceConnections.workspaceId, ws)),
    getAiContext(db, ws),
  ]);
  const t = (await cookies()).get(THEME_COOKIE)?.value;
  const theme: ThemeKey = t === "B" || t === "C" ? t : "A";
  return (
    <AppShell
      session={{ id: session.id, name: session.name, email: session.email, role: session.role, workspaceName: session.workspaceName, aiMode: ai.mode }}
      stats={{ products: p.n, activeJobs: j.n, review: r.n }}
      status={{
        aiMode: ai.mode,
        aiReason: ai.reason,
        connected: conns.filter((c) => c.status === "connected").map((c) => (c.platform === "shopee" ? "Shopee" : "Lazada")),
      }}
      initialTheme={theme}
    >
      {children}
    </AppShell>
  );
}
