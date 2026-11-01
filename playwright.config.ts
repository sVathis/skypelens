import { defineConfig, devices } from "@playwright/test";

// Browser tests for behaviour jsdom can't reproduce, such as report links reusing a
// named SkypeLens tab. Run with `bun run test:e2e` after
// `bunx playwright install chromium firefox`.
const PORT = 4179;
export const SKYPELENS_E2E_BASE_URL = `http://127.0.0.1:${PORT}/`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: SKYPELENS_E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
});
