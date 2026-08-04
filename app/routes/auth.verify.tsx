import { Form, Link, data, useActionData } from "react-router";

import type { Route } from "./+types/auth.verify";
import { authRequest } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await authRequest(
    request,
    context.cloudflare.env,
    "/api/auth/send-verification-email",
    "POST",
    {
      email: String(form.get("email") ?? ""),
      callbackURL: `${context.cloudflare.env.APP_ORIGIN}/auth/login?verified=1`,
    },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    return data(
      { error: payload?.message ?? "暂时无法发送验证邮件。" },
      { status: response.status },
    );
  }
  return data({ sent: true });
}

export default function VerifyEmail({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">验证邮箱</h1>
      <p className="mt-2 text-sm text-slate-600">
        打开邮件中的链接后即可完成验证；没有收到时可以重新发送。
      </p>
      {actionData && "error" in actionData ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "sent" in actionData && actionData.sent ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          验证邮件已发送。
        </p>
      ) : null}
      <Form method="post" className="mt-6 grid gap-4">
        <label className="grid gap-1">
          邮箱
          <input
            required
            type="email"
            name="email"
            defaultValue={loaderData.email}
            className="rounded-md border px-3 py-2"
          />
        </label>
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          重发验证邮件
        </button>
      </Form>
      <Link className="mt-5 inline-block text-sm underline" to="/auth/login">
        返回登录
      </Link>
    </main>
  );
}

export function loader({ request }: Route.LoaderArgs) {
  return { email: new URL(request.url).searchParams.get("email") ?? "" };
}
