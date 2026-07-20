import { expect, test } from "playwright/test";

function uniqueHandle(projectName: string) {
  const project = projectName === "mobile" ? "m" : "d";
  return `member_${project}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

test("registers a local account, keeps its handle immutable, and clears its session on logout", async ({
  page,
}, testInfo) => {
  const handle = uniqueHandle(testInfo.project.name);
  const email = `${handle}@example.test`;
  const password = "local-test-password";

  await page.goto("/auth/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name").fill("Identity Test User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Handle").fill(handle);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(new RegExp(`/users/${handle}$`));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByText(`@${handle}`)).toBeVisible();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const profileLink = page.getByRole("link", { name: `@${handle}` });
  if (testInfo.project.name === "mobile") {
    await expect(profileLink).toBeHidden();
  } else {
    await expect(profileLink).toBeVisible();
  }
  await page.getByRole("link", { name: "活跃" }).click();
  await expect(page).toHaveURL(/\?sort=active$/);
  await expect(page.getByRole("link", { name: "活跃" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("link", { name: "发布主题" }).click();
  await expect(page).toHaveURL(
    /\/boards\/00000000-0000-0000-0000-000000000101#create-thread$/,
  );

  const threadTitle = `First topic from ${handle}`;
  await page.goto("/boards/00000000-0000-0000-0000-000000000101", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await page.locator('input[name="title"]').fill(threadTitle);
  await page
    .locator('textarea[name="markdown"]')
    .fill("<script>alert(1)</script>\n\n**Safe preview**");
  await page.getByRole("button", { name: "预览 Markdown" }).click();
  const preview = page.getByRole("region", { name: "Markdown 预览" });
  await expect(preview.locator("strong")).toHaveText("Safe preview");
  await expect(preview.locator("script")).toHaveCount(0);
  await page
    .locator('textarea[name="markdown"]')
    .fill("A public post from a newly registered account.");
  await page.getByRole("button", { name: "发布主题" }).click();
  await expect(page).toHaveURL(/\/threads\//);
  await expect(page.getByRole("heading", { name: threadTitle })).toBeVisible();

  const handleUpdate = await page.evaluate(async () => {
    const response = await fetch("/api/auth/update-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "changed_handle" }),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  });
  expect(handleUpdate.status).toBe(400);
  expect(handleUpdate.body).toMatchObject({ code: "HANDLE_IMMUTABLE" });

  await page.goto("/settings/profile", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByText(`Your handle @${handle} is permanent.`),
  ).toBeVisible();
  await expect(page.getByLabel("Handle")).toHaveCount(0);
  await page.getByLabel("Display name").fill("Updated Identity User");
  await page.getByLabel("Biography").fill("Updated profile biography.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${handle}$`));
  await expect(
    page.getByRole("heading", { name: "Updated Identity User" }),
  ).toBeVisible();

  await page.goto("/auth/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name").fill("Duplicate Handle");
  await page.getByLabel("Email").fill(`duplicate-${email}`);
  await page.getByLabel("Handle").fill(handle.toUpperCase());
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/auth\/register$/);
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByLabel("Name").fill("Reserved Handle");
  await page.getByLabel("Email").fill(`reserved-${email}`);
  await page.getByLabel("Handle").fill("admin");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.evaluate(async () => {
    await fetch("/auth/logout", { method: "POST" });
  });
  await page.goto("/following", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/auth\/login$/);
});
