import { data, Form, redirect, useActionData } from "react-router";

import type { Route } from "./+types/admin.users";
import { accountStatusLabel } from "@/modules/identity/account";
import { getSession } from "@/modules/identity/auth.server";
import {
  listAdminUsers,
  parseAccountStatus,
  updateUserStatus,
} from "@/modules/identity/security.server";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";

async function access(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const decision = await authorizeDatabase(env.DB, {
    userId: session.user.id,
    permission: "users.manage",
  });
  if (!decision.allowed) throw new Response("Forbidden", { status: 403 });
  return session;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await access(request, context.cloudflare.env);
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const users = await listAdminUsers(context.cloudflare.env.DB, query);
  return { query, users: users.results };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await access(request, context.cloudflare.env);
  const form = await request.formData();
  const status = parseAccountStatus(String(form.get("status") ?? ""));
  if (!status) return data({ error: "用户状态无效。" }, { status: 400 });
  try {
    await updateUserStatus(context.cloudflare.env.DB, {
      actorUserId: session.user.id,
      targetUserId: String(form.get("userId") ?? ""),
      status,
      reason: String(form.get("reason") ?? ""),
    });
  } catch (error) {
    return data(
      { error: error instanceof Error ? error.message : "无法更新用户状态。" },
      { status: 400 },
    );
  }
  return redirect("/admin/users");
}

export default function AdminUsers({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header>
        <p className="text-sm text-slate-500">管理</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">用户</h1>
        <p className="mt-2 text-sm text-slate-600">
          停用或封禁会立即撤销用户的全部登录会话。
        </p>
      </header>
      {actionData?.error ? (
        <p
          role="alert"
          className="mt-5 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {actionData.error}
        </p>
      ) : null}
      <Form method="get" className="mt-8 flex gap-3">
        <input
          name="q"
          defaultValue={loaderData.query}
          placeholder="搜索姓名、邮箱或用户名"
          className="min-w-0 flex-1 rounded-md border px-3 py-2"
        />
        <button className="rounded-md border px-4 py-2 text-sm">搜索</button>
      </Form>
      <ol className="mt-6 space-y-3">
        {loaderData.users.map((user) => (
          <li key={user.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="font-semibold">{user.name}</h2>
                <p className="text-sm text-slate-600">
                  @{user.username ?? "-"} · {user.email}
                </p>
              </div>
              <p className="text-sm text-slate-500">
                {accountStatusLabel(user.status)} ·{" "}
                {user.emailVerified ? "已验证" : "未验证"}
              </p>
            </div>
            <Form
              method="post"
              className="mt-4 grid gap-2 sm:grid-cols-[10rem_1fr_auto]"
            >
              <input type="hidden" name="userId" value={user.id} />
              <select
                name="status"
                defaultValue={user.status}
                className="rounded-md border px-2 py-2 text-sm"
              >
                <option value="active">正常</option>
                <option value="suspended">暂时停用</option>
                <option value="banned">永久封禁</option>
                <option value="deleted">软删除</option>
              </select>
              <input
                name="reason"
                required
                maxLength={2000}
                placeholder="操作原因"
                className="rounded-md border px-3 py-2 text-sm"
              />
              <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                保存状态
              </button>
            </Form>
          </li>
        ))}
      </ol>
      {loaderData.users.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500">没有匹配用户。</p>
      ) : null}
    </main>
  );
}
