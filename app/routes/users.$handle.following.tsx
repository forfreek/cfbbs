import type { Route } from "./+types/users.$handle.following";
import { Link } from "react-router";

import {
  loadActorCollection,
  loadLocalActorCollectionOwner,
} from "@/modules/federation/collections";
import { validateHandle } from "@/modules/identity/handle";
import { listLocalFollowProfiles } from "@/modules/identity/local-follows";

export async function loader({ params, context }: Route.LoaderArgs) {
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
  const local = await listLocalFollowProfiles(context.cloudflare.env.DB, {
    userId: owner.actorId,
    direction: "following",
  });
  return { owner, actors: collection.items, localProfiles: local.results };
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
      {loaderData.localProfiles.length > 0 || actors.length > 0 ? (
        <ul className="mt-8 space-y-3">
          {loaderData.localProfiles.map((profile) => (
            <li key={profile.userId}>
              <Link className="hover:underline" to={`/users/${profile.handle}`}>
                {profile.displayName} @{profile.handle}
              </Link>
            </li>
          ))}
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
