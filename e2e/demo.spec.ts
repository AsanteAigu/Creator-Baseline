import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL ?? "owner@demo.agency";
const PASSWORD = process.env.E2E_PASSWORD ?? "creator-baseline-demo";

test("login → dashboard → account → scores → toggle a suggestion → reload → persisted", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await page.getByRole("link", { name: /Maya Okafor/ }).click();

  await expect(page.getByRole("heading", { name: "Maya Okafor" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Score per post/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top posts" })).toBeVisible();
  await expect(page.getByText("AI-generated advice. Review before you act on it.").first()).toBeVisible();

  await page.getByRole("link", { name: "This week's plan" }).first().click();
  await expect(page.getByRole("heading", { name: "This week's plan" })).toBeVisible();

  const card = page.getByTestId("suggestion-card").first();
  const used = card.getByTestId("suggestion-used");
  const wasPressed = (await used.getAttribute("aria-pressed")) === "true";
  const expected = wasPressed ? "false" : "true";

  const saved = page.waitForResponse((r) => r.url().includes("/api/suggestions/") && r.request().method() === "PATCH");
  await used.click();
  expect((await saved).status()).toBe(200);
  await expect(used).toHaveAttribute("aria-pressed", expected);

  await page.reload();
  await expect(page.getByTestId("suggestion-card").first().getByTestId("suggestion-used")).toHaveAttribute(
    "aria-pressed",
    expected,
  );
});
