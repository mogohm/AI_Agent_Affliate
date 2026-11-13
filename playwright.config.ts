import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3200";

/**
 * E2E tests run against a production build with an isolated, freshly-seeded PGlite database
 * (see scripts/e2e-server.mjs). Set E2E_SKIP_BUILD=1 to reuse an existing `.next` build.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? "node scripts/e2e-server.mjs" : "npm run build && node scripts/e2e-server.mjs",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
