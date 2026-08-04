import type { Route } from "./+types/api.push.config";

export async function loader({ context }: Route.LoaderArgs) {
  const key = (
    context.cloudflare.env as Env & { VAPID_PUBLIC_KEY?: string }
  ).VAPID_PUBLIC_KEY?.trim();
  if (!key)
    return Response.json(
      { ok: false, message: "Push 未配置。" },
      { status: 503 },
    );
  return Response.json(
    { ok: true, publicKey: key },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
