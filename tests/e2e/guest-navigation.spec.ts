import { expect, test } from "playwright/test";

test("renders the public home page and opens registration without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("CFBBS");
  await expect(page.getByRole("heading", { name: "全部主题" })).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);

  await page.getByRole("link", { name: "Create account" }).first().click();

  await expect(page).toHaveURL(/\/auth\/register$/);
  await expect(
    page.getByRole("heading", { name: "Create your CFBBS account" }),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
});
