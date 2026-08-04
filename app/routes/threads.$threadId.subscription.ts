import { redirect } from "react-router";

import type { Route } from "./+types/threads.$threadId.subscription";
import { setThreadSubscription } from "@/modules/forum/subscriptions";
import { getSession } from "@/modules/identity/auth.server";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const form = await request.formData();
  const rawMode = String(form.get("mode") ?? "");
  const mode = rawMode === "all" || rawMode === "mentions" ? rawMode : null;
  const result = await setThreadSubscription(context.cloudflare.env.DB, {
    userId: session.user.id,
    threadId: params.threadId ?? "",
    mode,
  });
  if (!result.ok) return new Response(result.message, { status: 400 });
  return redirect(`/threads/${params.threadId}`);
}
