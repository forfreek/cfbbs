import { expect, test } from "playwright/test";

function uniqueHandle(prefix: string, projectName: string) {
  const project = projectName === "mobile" ? "m" : "d";
  return `${prefix}_${project}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

test("delivers reply and like notifications and returns a new public topic in search", async ({
  page,
}, testInfo) => {
  const author = uniqueHandle("author", testInfo.project.name);
  const responder = uniqueHandle("responder", testInfo.project.name);
  const password = "forum-engagement-password";
  const title = `Searchable topic ${author}`;

  await page.goto("/auth/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name").fill("Author User");
  await page.getByLabel("Email").fill(`${author}@example.test`);
  await page.getByLabel("Handle").fill(author);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${author}$`));

  await page.goto("/boards/00000000-0000-0000-0000-000000000101", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[name="title"]').fill(title);
  await page
    .locator('textarea[name="markdown"]')
    .fill("A public topic used to verify search and notifications.");
  await page.getByRole("button", { name: "发布主题" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const threadUrl = page.url();

  await page.evaluate(async () => {
    await fetch("/auth/logout", { method: "POST" });
  });
  await page.goto("/auth/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name").fill("Responder User");
  await page.getByLabel("Email").fill(`${responder}@example.test`);
  await page.getByLabel("Handle").fill(responder);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${responder}$`));

  await page.goto(threadUrl, { waitUntil: "domcontentloaded" });
  await page
    .locator('textarea[name="markdown"]')
    .fill("A reply from another registered user.");
  await page.getByRole("button", { name: "发表回复" }).click();
  await expect(
    page.getByText("A reply from another registered user."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /点赞（0）/ })
    .first()
    .click();

  await page.evaluate(async () => {
    await fetch("/auth/logout", { method: "POST" });
  });
  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Handle").fill(author);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${author}$`));

  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Responder User 回复了你的主题")).toBeVisible();
  await expect(page.getByText("Responder User 赞了你的帖子")).toBeVisible();

  await page.goto(`/search?q=${encodeURIComponent(title)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
});
