/** Client-safe formatting helpers (Thai locale, Asia/Bangkok display). */
const TZ = "Asia/Bangkok";

export function thb(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return "฿" + new Intl.NumberFormat("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n < 100 && n % 1 ? 2 : 0) }).format(n);
}

export function usd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return "$" + n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 4 : digits);
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: digits }).format(n);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function dateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(t);
}

export function dateOnly(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const t = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(t.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short" }).format(t);
}

export function relativeTime(d: string | Date | null | undefined, now = Date.now()): string {
  if (!d) return "—";
  const t = (typeof d === "string" ? new Date(d) : d).getTime();
  const s = Math.round((now - t) / 1000);
  const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
  if (Math.abs(s) < 60) return rtf.format(-s, "second");
  if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  return rtf.format(-Math.round(s / 86400), "day");
}
