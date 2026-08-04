import type { Route } from "./+types/api.push.unsubscribe";
import { getSession } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST")
    return Response.json({ ok: false }, { status: 405 });
  const session = await getSession(request, context.cloudflare.env);
  if (!session)
    return Response.json({ ok: false, message: "请先登录。" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
  } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint)
    return Response.json(
      { ok: false, message: "推送端点无效。" },
      { status: 400 },
    );
  await context.cloudflare.env.DB.prepare(
    "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
  )
    .bind(session.user.id, endpoint)
    .run();
  return Response.json({ ok: true });
}
