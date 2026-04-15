import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:4444",
  },
  webServer: {
    command: "npm run preview -- --port 4444",
    port: 4444,
    reuseExistingServer: true,
  },
});
