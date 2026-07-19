import { Form, redirect } from "react-router";

import type { Route } from "./+types/settings.actor-preferences";
import { getSession } from "@/modules/identity/auth.server";
import {
  clearUserActorPreference,
  listUserActorPreferences,
  setUserActorPreference,
  type UserActorPreferenceState,
} from "@/modules/moderation/user-actor-preferences";

function isPreferenceState(value: string): value is UserActorPreferenceState {
  return value === "muted" || value === "blocked";
}

async function preferenceSession(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw redirect("/auth/login");
  return session;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await preferenceSession(request, context.cloudflare.env);
  const preferences = await listUserActorPreferences(
    context.cloudflare.env.DB,
    session.user.id,
  );
  return { preferences: preferences.results };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await preferenceSession(request, context.cloudflare.env);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actorId = String(form.get("actorId") ?? "");
  if (intent === "clear") {
    await clearUserActorPreference(context.cloudflare.env.DB, {
      userId: session.user.id,
      actorId,
      auditId: crypto.randomUUID(),
    });
    return redirect("/settings/actor-preferences");
  }
  const state = String(form.get("state") ?? "");
  if (intent !== "set" || !isPreferenceState(state)) {
    throw new Response("Invalid actor preference", { status: 400 });
  }
  await setUserActorPreference(context.cloudflare.env.DB, {
    userId: session.user.id,
    actorId,
    state,
    auditId: crypto.randomUUID(),
  });
  return redirect("/following");
}

export default function ActorPreferences({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        已静音和已屏蔽的账号
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        这些设置只影响你的内容流和通知。解除设置不会自动恢复之前已隐藏的通知。
      </p>
      {loaderData.preferences.length > 0 ? (
        <ol className="mt-8 divide-y border-y">
          {loaderData.preferences.map((preference) => (
            <li
              key={preference.actorId}
              className="flex items-center gap-4 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {preference.actorName || preference.actorUri}
                </p>
                <a
                  className="block truncate text-sm text-blue-700 hover:underline"
                  href={preference.actorUri}
                >
                  {preference.actorUri}
                </a>
              </div>
              <span className="text-sm text-slate-600">
                {preference.state === "muted" ? "已静音" : "已屏蔽"}
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="clear" />
                <input
                  type="hidden"
                  name="actorId"
                  value={preference.actorId}
                />
                <button className="text-sm text-blue-700 hover:underline">
                  解除
                </button>
              </Form>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-8 text-sm text-slate-500">尚未设置静音或屏蔽账号。</p>
      )}
    </main>
  );
}
