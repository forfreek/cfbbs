import { Link } from "react-router";

import type { Route } from "./+types/objects.$postId";
import {
  acceptsActivityStreams,
  isPublicNotePost,
  loadPublicNoteWithAttachments,
  publicNoteActivityResponse,
} from "@/modules/federation/object";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const post = await loadPublicNoteWithAttachments(
    context.cloudflare.env.DB,
    context.cloudflare.env.APP_ORIGIN,
    params.postId ?? "",
  );
  if (!post || !isPublicNotePost(post)) {
    throw new Response("Not found", { status: 404 });
  }

  if (acceptsActivityStreams(request.headers.get("accept") ?? "")) {
    return publicNoteActivityResponse(context.cloudflare.env.APP_ORIGIN, post);
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
      {post.attachments && post.attachments.length > 0 ? (
        <ul className="mt-6 space-y-2 text-sm">
          {post.attachments.map((attachment) => (
            <li key={attachment.url}>
              <a
                className="text-blue-700 hover:underline"
                href={attachment.url}
                rel="nofollow ugc noopener"
              >
                {attachment.name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
