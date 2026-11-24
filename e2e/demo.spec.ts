import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "owner@demo.agency";
const PASSWORD = process.env.E2E_PASSWORD ?? "creator-baseline-demo";

test("login → dashboard → account → scores → use an idea → tracked → reload → persisted", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: /Maya Okafor/ }).click();

  await expect(page.getByRole("heading", { name: "Maya Okafor" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Score per post/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top posts" })).toBeVisible();
  await expect(page.getByText("AI-generated advice. Review before you act on it.").first()).toBeVisible();

  await page.getByRole("link", { name: "This week's plan" }).first().click();
  await expect(page.getByRole("heading", { name: "This week's plan" })).toBeVisible();

  // Used ideas leave their day for the tracker and a new idea takes the day (D-047).
  const card = page.getByTestId("suggestion-card").last();
  const title = (await card.getByRole("heading").first().textContent())?.trim() ?? "";
  const saved = page.waitForResponse((r) => r.url().includes("/api/suggestions/") && r.request().method() === "PATCH");
  await card.getByTestId("suggestion-used").click();
  expect((await saved).status()).toBe(200);

  const tracker = page.locator("#tracker");
  await expect(tracker.getByTestId("tracked-idea").filter({ hasText: title })).toBeVisible();
  await page.reload();
  await expect(tracker.getByTestId("tracked-idea").filter({ hasText: title })).toBeVisible();
  await expect(page.getByTestId("suggestion-card").filter({ hasText: title })).toHaveCount(0);
});
