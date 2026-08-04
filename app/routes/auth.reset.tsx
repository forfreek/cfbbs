import { Form, Link, data, redirect, useActionData } from "react-router";

import type { Route } from "./+types/auth.reset";
import { authRequest } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await authRequest(
    request,
    context.cloudflare.env,
    "/api/auth/reset-password",
    "POST",
    {
      token: String(form.get("token") ?? ""),
      newPassword: String(form.get("password") ?? ""),
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return data(
      { error: payload?.message ?? "密码重置失败。" },
      { status: response.status },
    );
  }
  return redirect("/auth/login?reset=1");
}

export default function ResetPassword({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">设置新密码</h1>
      {loaderData.error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          重置链接无效或已过期，请重新申请。
        </p>
      ) : null}
      {actionData?.error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      <Form method="post" className="mt-6 grid gap-4">
        <input type="hidden" name="token" value={loaderData.token} />
        <label className="grid gap-1">
          新密码
          <input
            required
            minLength={12}
            type="password"
            name="password"
            className="rounded-md border px-3 py-2"
          />
        </label>
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          更新密码
        </button>
      </Form>
      <Link className="mt-5 inline-block text-sm underline" to="/auth/login">
        返回登录
      </Link>
    </main>
  );
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return {
    token: url.searchParams.get("token") ?? "",
    error: url.searchParams.get("error"),
  };
}
