import type { Route } from "./+types/users.$handle.followers";
import { Link } from "react-router";

import {
  actorCollectionPage,
  loadActorCollection,
  orderedCollection,
} from "@/modules/federation/collections";
import { acceptsActivityStreams } from "@/modules/federation/object";
import { validateHandle } from "@/modules/identity/handle";
import { createDatabase } from "@/db/client.server";
import { federationActors, profiles } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const handle = validateHandle(params.handle ?? "");
  if (!handle.ok) throw new Response("Not found", { status: 404 });
  const database = createDatabase(context.cloudflare.env.DB);
  const profile = await database.query.profiles.findFirst({
    where: eq(profiles.handle, handle.value),
  });
  if (!profile) throw new Response("Not found", { status: 404 });
  const actor = await database.query.federationActors.findFirst({
    where: and(
      eq(federationActors.id, profile.userId),
      eq(federationActors.isLocal, true),
    ),
  });
  if (!actor) throw new Response("Not found", { status: 404 });

  const collection = await loadActorCollection(
    context.cloudflare.env.DB,
    actor.id,
    "followers",
  );
  const page = new URL(request.url).searchParams.get("page") === "true";
  if (acceptsActivityStreams(request.headers.get("accept") ?? "")) {
    return Response.json(
      page
        ? actorCollectionPage(
            context.cloudflare.env.APP_ORIGIN,
            profile.handle,
            "followers",
            collection.items,
          )
        : orderedCollection(
            context.cloudflare.env.APP_ORIGIN,
            profile.handle,
            "followers",
            collection.total,
          ),
      { headers: { "content-type": "application/activity+json" } },
    );
  }
  return { profile, actors: collection.items };
}

export default function UserFollowers({ loaderData }: Route.ComponentProps) {
  const { profile, actors } = loaderData;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-muted-foreground text-sm">
        <Link className="hover:underline" to={`/users/${profile.handle}`}>
          @{profile.handle}
        </Link>
        的关注者
      </p>
      {actors.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {actors.map((actor) => (
            <li key={actor}>
              <a className="text-blue-700 hover:underline" href={actor}>
                {actor}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-8 text-sm text-slate-500">暂无公开关注者。</p>
      )}
    </main>
  );
}
