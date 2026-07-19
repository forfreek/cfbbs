import { Link } from "react-router";

import type { Route } from "./+types/users.$handle.outbox";
import { createDatabase } from "@/db/client.server";
import {
  loadPublicActorOutbox,
  orderedCollection,
  outboxPage,
} from "@/modules/federation/collections";
import { acceptsActivityStreams } from "@/modules/federation/object";
import { validateHandle } from "@/modules/identity/handle";
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

  const outbox = await loadPublicActorOutbox(
    context.cloudflare.env.DB,
    profile.userId,
  );
  const page = new URL(request.url).searchParams.get("page") === "true";
  if (acceptsActivityStreams(request.headers.get("accept") ?? "")) {
    return Response.json(
      page
        ? outboxPage(
            context.cloudflare.env.APP_ORIGIN,
            profile.handle,
            outbox.posts,
          )
        : orderedCollection(
            context.cloudflare.env.APP_ORIGIN,
            profile.handle,
            "outbox",
            outbox.total,
          ),
      { headers: { "content-type": "application/activity+json" } },
    );
  }

  return { profile, posts: outbox.posts };
}

export default function UserOutbox({ loaderData }: Route.ComponentProps) {
  const { profile, posts } = loaderData;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-muted-foreground text-sm">
        <Link className="hover:underline" to={`/users/${profile.handle}`}>
          @{profile.handle}
        </Link>
        的公开动态
      </p>
      {posts.length > 0 ? (
        <ol className="mt-8 space-y-5">
          {posts.map((post) => (
            <li key={post.id}>
              <Link
                className="text-blue-700 hover:underline"
                to={`/objects/${post.id}`}
              >
                {post.publishedAt.slice(0, 16).replace("T", " ")}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-8 text-sm text-slate-500">暂无公开动态。</p>
      )}
    </main>
  );
}
