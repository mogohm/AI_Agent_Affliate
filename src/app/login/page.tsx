import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSession().catch(() => null);
  const { next } = await searchParams;
  if (s) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  const showDemoHint = process.env.NODE_ENV !== "production" || process.env.SHOW_DEMO_LOGIN === "true";
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-[linear-gradient(140deg,var(--accent),var(--accent2))] text-xl font-black text-accent-fg">✦</div>
          <div>
            <strong className="block text-lg tracking-tight">AI AFFILIATE STUDIO</strong>
            <small className="text-[11px] font-bold tracking-[2px] text-muted">Affiliate Intelligence Platform</small>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-[20px] border border-line bg-surface p-6 shadow-card">
          <h1 className="mb-1 text-xl font-bold">เข้าสู่ระบบ</h1>
          <p className="mb-5 text-xs text-muted">ค้นหาสินค้าดี ทำคลิปไว วัดผลเป็น</p>
          <LoginForm next={next} />
        </div>
        {showDemoHint && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted">
            บัญชีเริ่มต้น (สร้างอัตโนมัติครั้งแรก): <b className="text-fg">{process.env.SEED_ADMIN_EMAIL ?? "admin@example.com"}</b> / รหัสผ่านตาม SEED_ADMIN_PASSWORD
            <br />
            บัญชีทดสอบสิทธิ์: editor@ · approver@ · viewer@example.com (รหัสผ่านเดียวกัน)
          </p>
        )}
      </div>
    </div>
  );
}
