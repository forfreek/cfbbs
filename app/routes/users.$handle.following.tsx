import type { Route } from "./+types/users.$handle.following";
import { Link } from "react-router";

import {
  actorCollectionPage,
  loadActorCollection,
  loadLocalActorCollectionOwner,
  orderedCollection,
} from "@/modules/federation/collections";
import { acceptsActivityStreams } from "@/modules/federation/object";
import { validateHandle } from "@/modules/identity/handle";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const handle = validateHandle(params.handle ?? "");
  if (!handle.ok) throw new Response("Not found", { status: 404 });
  const owner = await loadLocalActorCollectionOwner(
    context.cloudflare.env.DB,
    handle.value,
  );
  if (!owner) throw new Response("Not found", { status: 404 });

  const collection = await loadActorCollection(
    context.cloudflare.env.DB,
    owner.actorId,
    "following",
  );
  const page = new URL(request.url).searchParams.get("page") === "true";
  if (acceptsActivityStreams(request.headers.get("accept") ?? "")) {
    return Response.json(
      page
        ? actorCollectionPage(
            context.cloudflare.env.APP_ORIGIN,
            owner.handle,
            "following",
            collection.items,
          )
        : orderedCollection(
            context.cloudflare.env.APP_ORIGIN,
            owner.handle,
            "following",
            collection.total,
          ),
      { headers: { "content-type": "application/activity+json" } },
    );
  }
  return { owner, actors: collection.items };
}

export default function UserFollowing({ loaderData }: Route.ComponentProps) {
  const { owner, actors } = loaderData;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-muted-foreground text-sm">
        <Link className="hover:underline" to={`/users/${owner.handle}`}>
          @{owner.handle}
        </Link>
        正在关注
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
        <p className="mt-8 text-sm text-slate-500">暂无公开关注。</p>
      )}
    </main>
  );
}
