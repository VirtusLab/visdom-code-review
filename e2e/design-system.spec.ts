import { test, expect } from "@playwright/test";

const BASE = "/visdom-code-review";

test.describe("Design system components on code-review site", () => {
  test("homepage renders HeroSection", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.locator("h1")).toContainText("Code Review");
  });

  test("homepage has no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("Callout renders on architecture page", async ({ page }) => {
    await page.goto(`${BASE}/reference/architecture/`);
    await expect(
      page.getByText("Deterministic signals first")
    ).toBeVisible();
  });

  test("LayerBadge renders on architecture page", async ({ page }) => {
    await page.goto(`${BASE}/reference/architecture/`);
    await expect(
      page.getByRole("link", { name: /Layer 0: Context/ })
    ).toBeVisible();
  });

  test("StatCard renders on before-after page", async ({ page }) => {
    await page.goto(`${BASE}/before-after/`);
    // ImpactNumber components show before→after values
    await expect(page.getByText("→").first()).toBeVisible();
  });

  test("PersonaCard renders on leaders guide", async ({ page }) => {
    await page.goto(`${BASE}/guide/leaders/`);
    await expect(
      page.getByText("Engineering Leader").first()
    ).toBeVisible();
  });

  test("ResourceCard renders on reference index", async ({ page }) => {
    await page.goto(`${BASE}/reference/`);
    await expect(
      page.getByRole("link", { name: /Architecture/ }).first()
    ).toBeVisible();
  });

  test("all key pages return 200", async ({ request }) => {
    const pages = [
      "/",
      "/reference/",
      "/reference/architecture/",
      "/guide/leaders/",
      "/guide/developers/",
      "/guide/platform-engineers/",
      "/before-after/",
      "/reference/configuration/",
      "/reference/metrics/",
      "/reference/evaluation/",
      "/reference/reporter/",
      "/reference/layers/context-collection/",
      "/reference/layers/deterministic-gate/",
      "/reference/layers/ai-quick-scan/",
      "/reference/layers/ai-deep-review/",
      "/reference/proactive-scanner/",
      "/reference/reference-implementations/",
    ];
    for (const path of pages) {
      const response = await request.get(`${BASE}${path}`);
      expect(response.status(), `${path} should return 200`).toBe(200);
    }
  });

  test("no console errors across pages", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const pages = ["/", "/reference/architecture/", "/guide/leaders/", "/before-after/"];
    for (const path of pages) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(300);
    }
    expect(errors).toEqual([]);
  });

  test("visual: homepage", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveScreenshot("homepage.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.1,
    });
  });

  test("visual: architecture", async ({ page }) => {
    await page.goto(`${BASE}/reference/architecture/`);
    await expect(page).toHaveScreenshot("architecture.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.1,
    });
  });
});
