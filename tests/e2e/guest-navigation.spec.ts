import { expect, test } from "playwright/test";

test("renders the public home page and opens registration without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto("/", { waitUntil: "domcontentloaded" });

  expect(response?.status()).toBe(200);
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

test("requires a local session before opening the following feed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/following", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("requires a local session before opening protected administration and editing pages", async ({
  page,
}) => {
  for (const path of [
    "/admin/boards",
    "/admin/groups",
    "/posts/missing-post/edit",
  ]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth\/login$/);
  }
});
