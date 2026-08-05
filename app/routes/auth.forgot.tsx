import {
  Form,
  Link,
  data,
  useActionData,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/auth.forgot";
import { authRequest } from "@/modules/identity/auth.server";
import { getMessage, type Locale } from "@/modules/i18n/messages";

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
  const root = useRouteLoaderData("root") as { locale?: Locale } | undefined;
  const locale = root?.locale ?? "zh-CN";
  const t = (key: Parameters<typeof getMessage>[1]) => getMessage(locale, key);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">{t("forgotTitle")}</h1>
      <p className="mt-2 text-sm text-slate-600">{t("forgotDescription")}</p>
      {actionData && "error" in actionData ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "sent" in actionData && actionData.sent ? (
        <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {t("forgotSent")}
        </p>
      ) : null}
      <Form method="post" className="mt-6 grid gap-4">
        <label className="grid gap-1">
          {t("forgotEmail")}
          <input
            required
            type="email"
            name="email"
            className="rounded-md border px-3 py-2"
          />
        </label>
        <button className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {t("forgotSubmit")}
        </button>
      </Form>
      <Link className="mt-5 inline-block text-sm underline" to="/auth/login">
        {t("backToLogin")}
      </Link>
    </main>
  );
}
