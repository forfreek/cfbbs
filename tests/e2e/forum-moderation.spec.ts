import { execFileSync } from "node:child_process";
import { expect, test } from "playwright/test";

const administratorsGroupId = "00000000-0000-0000-0000-000000000001";

function uniqueHandle(projectName: string) {
  const project = projectName === "mobile" ? "m" : "d";
  return `moderator_${project}${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function grantAdministratorMembership(email: string) {
  const escapedEmail = email.replaceAll("'", "''");
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "cfbbs-local",
      "--local",
      "--command",
      `INSERT OR IGNORE INTO group_members (group_id, user_id, created_at) SELECT '${administratorsGroupId}', id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM user WHERE email = '${escapedEmail}'`,
    ],
    { cwd: process.cwd(), stdio: "pipe" },
  );
}

test("allows an authorized moderator to pin and lock a public topic", async ({
  page,
}, testInfo) => {
  const handle = uniqueHandle(testInfo.project.name);
  const email = `${handle}@example.test`;
  const password = "forum-moderation-password";
  const title = `Moderated topic ${handle}`;

  await page.goto("/auth/register", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Name").fill("Moderator Test User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Handle").fill(handle);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/${handle}$`));

  grantAdministratorMembership(email);
  await page.goto("/boards/00000000-0000-0000-0000-000000000101", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[name="title"]').fill(title);
  await page
    .locator('textarea[name="markdown"]')
    .fill("A topic used to verify moderation actions.");
  await page.getByRole("button", { name: "发布主题" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByRole("button", { name: "置顶主题" }).click();
  await expect(page.getByText("本主题已置顶。")).toBeVisible();
  await expect(page.getByRole("button", { name: "取消置顶" })).toBeVisible();

  await page.getByRole("button", { name: "锁定主题" }).click();
  await expect(page.getByText("本主题已锁定。")).toBeVisible();
  await expect(page.getByRole("button", { name: "解除锁定" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "回复主题" })).toHaveCount(0);
});
