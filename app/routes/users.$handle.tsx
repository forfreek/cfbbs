import { eq } from "drizzle-orm";
import { Link } from "react-router";

import type { Route } from "./+types/users.$handle";
import { createDatabase } from "@/db/client.server";
import { profiles } from "@/db/schema";
import { validateHandle } from "@/modules/identity/handle";
import { personActor } from "@/modules/federation/actor";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const handle = validateHandle(params.handle ?? "");
  if (!handle.ok) throw new Response("Not found", { status: 404 });
  const profile = await createDatabase(
    context.cloudflare.env.DB,
  ).query.profiles.findFirst({ where: eq(profiles.handle, handle.value) });
  if (!profile) throw new Response("Not found", { status: 404 });
  const accept = request.headers.get("accept") ?? "";
  if (
    accept.includes("application/activity+json") ||
    accept.includes("application/ld+json")
  ) {
    return Response.json(
      personActor(context.cloudflare.env.APP_ORIGIN, profile),
      { headers: { "content-type": "application/activity+json" } },
    );
  }
  return { profile };
}

export default function UserProfile({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-start gap-5">
        {profile.avatarUrl ? (
          <img
            className="size-16 rounded-full object-cover"
            src={profile.avatarUrl}
            alt=""
          />
        ) : (
          <div className="bg-muted grid size-16 place-items-center rounded-full text-xl">
            {profile.displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-muted-foreground text-sm">@{profile.handle}</p>
          <h1 className="text-3xl font-semibold">{profile.displayName}</h1>
        </div>
      </div>
      {profile.bio && (
        <p className="mt-8 leading-7 whitespace-pre-wrap">{profile.bio}</p>
      )}
      <Link to="/" className="mt-10 inline-block text-sm underline">
        Back to CFBBS
      </Link>
    </main>
  );
}
