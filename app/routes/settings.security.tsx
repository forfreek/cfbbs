import { data, Form, redirect, useActionData } from "react-router";

import type { Route } from "./+types/settings.security";
import { authRequest, getSession } from "@/modules/identity/auth.server";
import {
  listUserSessions,
  revokeAllUserSessions,
  revokeUserSession,
  softDeleteUser,
} from "@/modules/identity/security.server";

async function securityData(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  const sessions = await listUserSessions(env.DB, session.user.id);
  return { session, sessions: sessions.results };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  return securityData(request, context.cloudflare.env);
}

export async function action({ request, context }: Route.ActionArgs) {
  const current = await securityData(request, context.cloudflare.env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "revoke-session") {
    await revokeUserSession(
      context.cloudflare.env.DB,
      current.session.user.id,
      String(form.get("sessionId") ?? ""),
    );
    return redirect("/settings/security");
  }
  if (intent === "revoke-all") {
    await revokeAllUserSessions(
      context.cloudflare.env.DB,
      current.session.user.id,
    );
    return redirect("/auth/login");
  }
  if (intent === "change-password") {
    const response = await authRequest(
      request,
      context.cloudflare.env,
      "/api/auth/change-password",
      "POST",
      {
        currentPassword: String(form.get("currentPassword") ?? ""),
        newPassword: String(form.get("newPassword") ?? ""),
        revokeOtherSessions: true,
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      return data(
        { error: payload?.message ?? "密码修改失败。" },
        { status: response.status },
      );
    }
    return redirect("/settings/security?changed=1");
  }
  if (intent === "delete-account") {
    try {
      await softDeleteUser(context.cloudflare.env.DB, {
        actorUserId: current.session.user.id,
        userId: current.session.user.id,
        reason: "用户自行删除账户",
      });
    } catch (error) {
      return data(
        { error: error instanceof Error ? error.message : "无法删除账户。" },
        { status: 400 },
      );
    }
    return redirect("/auth/login?deleted=1");
  }
  return data({ error: "未知操作。" }, { status: 400 });
}

export default function SecuritySettings({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">账户安全</h1>
      {actionData?.error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      <section className="mt-8 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">修改密码</h2>
        <Form method="post" className="mt-4 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="intent" value="change-password" />
          <input
            required
            type="password"
            name="currentPassword"
            placeholder="当前密码"
            className="rounded-md border px-3 py-2"
          />
          <input
            required
            minLength={12}
            type="password"
            name="newPassword"
            placeholder="新密码（至少 12 位）"
            className="rounded-md border px-3 py-2"
          />
          <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            更新密码
          </button>
        </Form>
      </section>
      <section className="mt-8 rounded-lg border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">登录会话</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="revoke-all" />
            <button className="text-sm text-red-700 hover:underline">
              撤销全部会话
            </button>
          </Form>
        </div>
        <ul className="mt-4 space-y-3">
          {loaderData.sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-3 text-sm"
            >
              <span>
                {session.userAgent ?? "未知设备"} ·{" "}
                {session.ipAddress ?? "未知 IP"}
                <br />
                <span className="text-xs text-slate-500">
                  创建于 {session.createdAt}
                </span>
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="revoke-session" />
                <input type="hidden" name="sessionId" value={session.id} />
                <button className="text-red-700 hover:underline">撤销</button>
              </Form>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8 rounded-lg border border-red-200 p-5">
        <h2 className="text-lg font-semibold text-red-800">删除账户</h2>
        <p className="mt-2 text-sm text-slate-600">
          账户会软删除并立即退出所有会话，历史内容仍保留必要的联邦关联。
        </p>
        <Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="delete-account" />
          <button className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800">
            删除我的账户
          </button>
        </Form>
      </section>
    </main>
  );
}
