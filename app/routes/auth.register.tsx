import { Form, Link, data, redirect, useActionData } from "react-router";

import type { Route } from "./+types/auth.register";
import { handleAuthRequest } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const response = await handleAuthRequest(
    new Request(new URL("/api/auth/sign-up/email", request.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: context.cloudflare.env.APP_ORIGIN,
      },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        username: form.get("username"),
        password: form.get("password"),
      }),
    }),
    context.cloudflare.env,
  );
  const payload = (await response.json()) as {
    user?: { username?: string };
    message?: string;
  };
  if (!response.ok || !payload.user?.username)
    return data(
      { error: payload.message ?? "注册失败，请稍后重试。" },
      { status: response.status },
    );
  const setCookie = response.headers.get("set-cookie") ?? "";
  return redirect(
    setCookie
      ? `/users/${payload.user.username}`
      : `/auth/verify?email=${encodeURIComponent(String(form.get("email") ?? ""))}`,
    {
      headers: setCookie ? { "set-cookie": setCookie } : undefined,
    },
  );
}

export default function Register() {
  const actionData = useActionData<typeof action>();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">创建 CFBBS 账号</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        用户名会成为你永久的联邦身份，创建后不可修改。
      </p>
      {actionData?.error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {actionData.error}
        </p>
      )}
      <Form method="post" className="mt-6 grid gap-4">
        <label>
          昵称
          <input
            required
            name="name"
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          邮箱
          <input
            required
            name="email"
            type="email"
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          用户名
          <input
            required
            name="username"
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_]+"
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <label>
          密码
          <input
            required
            name="password"
            type="password"
            minLength={12}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>
        <button className="bg-primary text-primary-foreground rounded-md px-4 py-2">
          创建账号
        </button>
      </Form>
      <p className="mt-5 text-sm">
        已有账号？{" "}
        <Link className="underline" to="/auth/login">
          登录
        </Link>
      </p>
    </main>
  );
}
