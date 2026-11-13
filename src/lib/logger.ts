/** Minimal structured JSON logger. Never pass secrets in `data`. */
type Level = "debug" | "info" | "warn" | "error";

const REDACT = /(api[_-]?key|secret|password|token|authorization)/i;

function redact(data: Record<string, unknown> | undefined) {
  if (!data) return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = REDACT.test(k) ? "[redacted]" : v;
  return out;
}

function log(level: Level, msg: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "debug") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...redact(data) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}

export const logger = {
  debug: (m: string, d?: Record<string, unknown>) => log("debug", m, d),
  info: (m: string, d?: Record<string, unknown>) => log("info", m, d),
  warn: (m: string, d?: Record<string, unknown>) => log("warn", m, d),
  error: (m: string, d?: Record<string, unknown>) => log("error", m, d),
};
