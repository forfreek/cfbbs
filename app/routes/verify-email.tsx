import { Link, data, redirect, useLoaderData } from "react-router";

import type { Route } from "./+types/verify-email";
import { handleAuthRequest } from "@/modules/identity/auth.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const source = new URL(request.url);
  const target = new URL("/api/auth/verify-email", request.url);
  target.search = source.search;
  const response = await handleAuthRequest(
    new Request(target, {
      method: "GET",
      headers: { origin: context.cloudflare.env.APP_ORIGIN },
    }),
    context.cloudflare.env,
  );
  if (response.ok) return redirect("/auth/login?verified=1");
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return data({ error: payload?.message ?? "验证链接无效或已过期。" });
}

export default function VerifyEmailResult() {
  const loaderData = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">邮箱验证失败</h1>
      <p className="mt-3 text-sm text-slate-600">{loaderData.error}</p>
      <Link className="mt-5 inline-block text-sm underline" to="/auth/verify">
        返回重新发送
      </Link>
    </main>
  );
}
