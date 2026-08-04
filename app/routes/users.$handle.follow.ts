import { redirect } from "react-router";
import { eq } from "drizzle-orm";

import type { Route } from "./+types/users.$handle.follow";
import { createDatabase } from "@/db/client.server";
import { profiles } from "@/db/schema";
import { setLocalFollow } from "@/modules/identity/local-follows";
import { getSession } from "@/modules/identity/auth.server";
import { validateHandle } from "@/modules/identity/handle";

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const handle = validateHandle(params.handle ?? "");
  if (!handle.ok) throw new Response("Not found", { status: 404 });
  const profile = await createDatabase(
    context.cloudflare.env.DB,
  ).query.profiles.findFirst({
    where: eq(profiles.handle, handle.value),
  });
  if (!profile) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const following = String(form.get("following") ?? "false") === "true";
  const result = await setLocalFollow(context.cloudflare.env.DB, {
    followerUserId: session.user.id,
    followingUserId: profile.userId,
    following,
  });
  if (!result.ok) return new Response(result.message, { status: 400 });
  return redirect(`/users/${handle.value}`);
}
