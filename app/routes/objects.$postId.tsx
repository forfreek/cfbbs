import { Link } from "react-router";

import type { Route } from "./+types/objects.$postId";
import {
  acceptsActivityStreams,
  isPublicNotePost,
  loadPublicNote,
} from "@/modules/federation/object";
import { noteObject } from "@/modules/federation/note";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const post = await loadPublicNote(
    context.cloudflare.env.DB,
    params.postId ?? "",
  );
  if (!post || !isPublicNotePost(post)) {
    throw new Response("Not found", { status: 404 });
  }

  if (acceptsActivityStreams(request.headers.get("accept") ?? "")) {
    return Response.json(noteObject(context.cloudflare.env.APP_ORIGIN, post), {
      headers: { "content-type": "application/activity+json" },
    });
  }

  return { post };
}

export default function PublicNote({ loaderData }: Route.ComponentProps) {
  const { post } = loaderData;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-muted-foreground text-sm">
        <Link className="hover:underline" to={`/users/${post.authorHandle}`}>
          @{post.authorHandle}
        </Link>
        <time className="ml-3" dateTime={post.publishedAt}>
          {post.publishedAt.slice(0, 16).replace("T", " ")}
        </time>
      </p>
      <article
        className="prose prose-slate mt-6 max-w-none"
        dangerouslySetInnerHTML={{ __html: post.html }}
      />
    </main>
  );
}
