"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Gem,
  Sparkles,
  Workflow,
  ListChecks,
  Clapperboard,
  TrendingUp,
  Settings,
  LogOut,
  Plus,
  Menu,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SessionProvider, type ClientSession } from "@/components/session-context";
import { ROLE_LABELS, can } from "@/lib/auth/permissions";
import { THEME_COOKIE, THEMES, type ThemeKey } from "@/lib/theme";

/** Persist theme choice (cookie read by the root layout to avoid a flash on reload). */
function applyTheme(t: ThemeKey) {
  document.documentElement.setAttribute("data-theme", t);
  document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
}

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; count?: number; title: string };

export type ShellStats = { products: number; activeJobs: number; review: number };
export type ShellStatus = { aiMode: "demo" | "live"; aiReason: string | null; connected: string[] };

export function AppShell({
  session,
  stats,
  status,
  initialTheme,
  children,
}: {
  session: ClientSession;
  stats: ShellStats;
  status: ShellStatus;
  initialTheme: ThemeKey;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = React.useState<ThemeKey>(initialTheme);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const workspace: NavItem[] = [
    { href: "/dashboard", label: "ภาพรวมธุรกิจ", title: "ภาพรวมธุรกิจ", icon: LayoutDashboard },
    { href: "/products", label: "สินค้าและค่าคอม", title: "สินค้าและค่าคอมมิชชัน", icon: Gem, count: stats.products },
    { href: "/studio", label: "AI Video Studio", title: "AI Video Studio", icon: Sparkles },
    { href: "/automation", label: "Automation Factory", title: "Automation Factory", icon: Workflow },
    { href: "/queue", label: "คิวงาน", title: "คิวงานและสถานะ Worker", icon: ListChecks, count: stats.activeJobs },
    { href: "/library", label: "คลิปและการเผยแพร่", title: "คอนเทนต์และการเผยแพร่", icon: Clapperboard, count: stats.review },
    { href: "/analytics", label: "รายได้และวิเคราะห์", title: "รายได้และวิเคราะห์", icon: TrendingUp },
  ];
  const admin: NavItem[] = [{ href: "/settings", label: "เชื่อมต่อและตั้งค่า", title: "ตั้งค่าและเชื่อมต่อ", icon: Settings }];
  const current = [...workspace, ...admin].find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));

  const chooseTheme = (t: ThemeKey) => {
    setTheme(t);
    applyTheme(t);
    toast.success(`เปลี่ยนรูปแบบ UI เป็น Design ${t} — ${THEMES.find((x) => x.key === t)?.name}`);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- close the mobile drawer on navigation
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const navList = (items: NavItem[]) => (
    <nav className="flex flex-col gap-1">
      {items.map((n) => {
        const active = current?.href === n.href;
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-fg",
              active && "nav-active",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-[18px] shrink-0" />
            <span className="nav-label truncate">{n.label}</span>
            {!!n.count && <span className="nav-count ml-auto rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">{n.count}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-5">
      <Link href="/dashboard" className="flex items-center gap-3 px-2 pt-1 pb-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(140deg,var(--accent),var(--accent2))] text-xl font-black text-accent-fg shadow-[0_5px_22px_#6964ed54]">
          ✦
        </div>
        <div className="nav-label">
          <strong className="block text-base tracking-tight">AI AFFILIATE</strong>
          <small className="mt-0.5 block text-[10px] font-bold tracking-[2px] text-muted">STUDIO / 2026</small>
        </div>
      </Link>
      <div>
        <div className="nav-label mb-2 px-3 text-[10px] font-extrabold tracking-[1.6px] text-muted">WORKSPACE</div>
        {navList(workspace)}
        <div className="nav-label mt-4 mb-2 px-3 text-[10px] font-extrabold tracking-[1.6px] text-muted">ADMINISTRATION</div>
        {navList(admin)}
      </div>
      <div className="nav-label mt-auto space-y-3">
        <div className="rounded-xl border border-line bg-surface p-3 text-[11px] leading-relaxed text-muted" data-testid="mode-flag">
          <b className={status.aiMode === "live" ? "text-good" : "text-warn"}>● AI: {status.aiMode === "live" ? "LIVE (OpenAI)" : "DEMO MODE"}</b>
          <br />
          {status.aiMode === "demo" ? "สคริปต์/ภาพ/เสียงสร้างด้วยตัวสร้างตัวอย่าง ไม่เรียก API ที่มีค่าใช้จ่าย" : "เรียก OpenAI API จริง — ควบคุมด้วยงบประมาณ"}
          <br />
          <b className="text-fg">Marketplace:</b> {status.connected.length ? status.connected.join(", ") + " เชื่อมแล้ว" : "ยังไม่เชื่อม API (ใช้ CSV/Manual)"}
        </div>
        <div className="flex items-center gap-2.5 px-1">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#ffc08d,#8e73ed)] text-xs font-black text-white">
            {session.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-xs">{session.name}</strong>
            <span className="text-[11px] text-muted">{ROLE_LABELS[session.role]}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <LogOut />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <SessionProvider value={session}>
      <div className="app-grid min-h-screen lg:grid lg:grid-cols-[247px_minmax(0,1fr)]">
        <aside className="sticky top-0 hidden h-screen overflow-auto border-r border-line bg-side px-4 py-6 lg:block">{sidebar}</aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-[260px] overflow-auto border-r border-line bg-side px-4 py-6">{sidebar}</aside>
          </div>
        )}
        <main className="min-w-0">
          <header className="sticky top-0 z-30 flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur sm:px-7">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen((v) => !v)} aria-label="เมนู">
                {mobileOpen ? <X /> : <Menu />}
              </Button>
              <div>
                <div className="text-[10px] font-extrabold tracking-[2px] text-accent-2 uppercase">Affiliate Intelligence Platform</div>
                <h1 className="text-xl font-bold tracking-tight sm:text-[23px]">{current?.title ?? "AI Affiliate Studio"}</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={status.aiMode === "live" ? "green" : "orange"} title={status.aiReason ?? undefined}>
                ● {status.aiMode === "live" ? "Live AI" : "Demo mode"}
              </Badge>
              <div className="flex gap-0.5 rounded-[11px] border border-line bg-surface p-[3px]" role="radiogroup" aria-label="เลือกแนวดีไซน์">
                {THEMES.map((t) => (
                  <button
                    key={t.key}
                    role="radio"
                    aria-checked={theme === t.key}
                    title={`${t.name} — ${t.description}`}
                    onClick={() => chooseTheme(t.key)}
                    className={cn(
                      "min-w-[26px] cursor-pointer rounded-[7px] px-2 py-1 text-[11px] font-extrabold text-muted",
                      theme === t.key && "bg-accent text-accent-fg",
                    )}
                  >
                    {t.key}
                  </button>
                ))}
              </div>
              {can(session.role, "video:create") && (
                <Button asChild variant="primary" size="sm">
                  <Link href="/studio?new=1">
                    <Plus /> สร้างวิดีโอ
                  </Link>
                </Button>
              )}
            </div>
          </header>
          <div className="mx-auto max-w-[1700px] px-3 pt-6 pb-16 sm:px-7">{children}</div>
        </main>
      </div>
    </SessionProvider>
  );
}
