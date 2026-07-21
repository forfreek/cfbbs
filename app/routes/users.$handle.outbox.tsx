import { Link } from "react-router";

import type { Route } from "./+types/users.$handle.outbox";
import {
  loadPublicActorOutbox,
  loadLocalActorCollectionOwner,
} from "@/modules/federation/collections";
import { validateHandle } from "@/modules/identity/handle";

export async function loader({ params, context }: Route.LoaderArgs) {
  const handle = validateHandle(params.handle ?? "");
  if (!handle.ok) throw new Response("Not found", { status: 404 });

  const owner = await loadLocalActorCollectionOwner(
    context.cloudflare.env.DB,
    handle.value,
  );
  if (!owner) throw new Response("Not found", { status: 404 });

  const outbox = await loadPublicActorOutbox(
    context.cloudflare.env.DB,
    owner.actorId,
  );
  return { owner, posts: outbox.posts };
}

export default function UserOutbox({ loaderData }: Route.ComponentProps) {
  const { owner, posts } = loaderData;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-muted-foreground text-sm">
        <Link className="hover:underline" to={`/users/${owner.handle}`}>
          @{owner.handle}
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
