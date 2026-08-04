import { Form, Link, data, useActionData } from "react-router";

import type { Route } from "./+types/auth.forgot";
import { authRequest } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await authRequest(
    request,
    context.cloudflare.env,
    "/api/auth/request-password-reset",
    "POST",
    {
      email: String(form.get("email") ?? ""),
      redirectTo: `${context.cloudflare.env.APP_ORIGIN}/auth/reset`,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return data(
      { error: payload?.message ?? "暂时无法发送重置邮件。" },
      { status: response.status },
    );
  }
  return data({ sent: true });
}

export default function ForgotPassword() {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">重置密码</h1>
      <p className="mt-2 text-sm text-slate-600">
        输入注册邮箱后，我们会发送一次性重置链接。
      </p>
      {actionData && "error" in actionData ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "sent" in actionData && actionData.sent ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          如果邮箱存在，重置链接已经发送，请检查收件箱。
        </p>
      ) : null}
      <Form method="post" className="mt-6 grid gap-4">
        <label className="grid gap-1">
          邮箱
          <input
            required
            type="email"
            name="email"
            className="rounded-md border px-3 py-2"
          />
        </label>
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          发送重置邮件
        </button>
      </Form>
      <Link className="mt-5 inline-block text-sm underline" to="/auth/login">
        返回登录
      </Link>
    </main>
  );
}
