// Windows: a lower-case drive letter in cwd (d:\ vs D:\) makes Vitest load itself twice
// ("failed to find the current suite"). Normalise cwd before launching Vitest.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.platform === "win32" ? root.replace(/^[a-z]:/, (m) => m.toUpperCase()) : root;
const bin = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(r.status ?? 1);
