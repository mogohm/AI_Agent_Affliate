// Starts a production Next.js server against a FRESH, isolated PGlite database and storage dir
// for Playwright. Run `npm run build` first (the Playwright config does this for you).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".data", "e2e");
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const port = process.env.E2E_PORT ?? "3200";
const env = {
  ...process.env,
  NODE_ENV: "production",
  APP_URL: `http://localhost:${port}`,
  DATABASE_URL: `pglite://${path.join(dataDir, "pglite").replace(/\\/g, "/")}`,
  LOCAL_STORAGE_DIR: path.join(dataDir, "storage"),
  AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
  WORKER_INLINE: "true",
  SEED_DEMO_DATA: "true",
  SEED_ADMIN_EMAIL: "admin@example.com",
  SEED_ADMIN_PASSWORD: "ChangeMe!2026",
  OPENAI_API_KEY: "",
  RENDER_WIDTH: "360",
  RENDER_HEIGHT: "640",
  RENDER_FPS: "15",
};
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", port], { cwd: root, env, stdio: "inherit" });
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
