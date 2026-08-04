import type { Route } from "./+types/api.push.subscribe";
import { getSession } from "@/modules/identity/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST")
    return Response.json({ ok: false }, { status: 405 });
  const session = await getSession(request, context.cloudflare.env);
  if (!session)
    return Response.json({ ok: false, message: "请先登录。" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: "请求无效。" }, { status: 400 });
  }
  if (!body || typeof body !== "object")
    return Response.json({ ok: false, message: "请求无效。" }, { status: 400 });
  const value = body as Record<string, unknown>;
  const endpoint = typeof value.endpoint === "string" ? value.endpoint : "";
  const keys =
    value.keys && typeof value.keys === "object"
      ? (value.keys as Record<string, unknown>)
      : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  try {
    if (new URL(endpoint).protocol !== "https:") throw new Error();
  } catch {
    return Response.json(
      { ok: false, message: "推送端点无效。" },
      { status: 400 },
    );
  }
  if (
    !endpoint ||
    !p256dh ||
    !auth ||
    endpoint.length > 2_000 ||
    p256dh.length > 256 ||
    auth.length > 256
  ) {
    return Response.json(
      { ok: false, message: "推送订阅无效。" },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  await context.cloudflare.env.DB.prepare(
    "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, last_used_at = excluded.last_used_at",
  )
    .bind(
      crypto.randomUUID(),
      session.user.id,
      endpoint,
      p256dh,
      auth,
      request.headers.get("user-agent"),
      now,
      now,
    )
    .run();
  return Response.json({ ok: true });
}
