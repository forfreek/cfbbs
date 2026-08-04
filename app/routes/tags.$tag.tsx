import { Link } from "react-router";
import type { Route } from "./+types/tags.$tag";

export async function loader({ params, context }: Route.LoaderArgs) {
  const tag = (params.tag ?? "").toLocaleLowerCase("en-US");
  const rows = await context.cloudflare.env.DB.prepare(
    "SELECT posts.id, posts.thread_id AS threadId, threads.title, posts.rendered_html AS renderedHtml, posts.published_at AS publishedAt, profiles.handle FROM post_hashtags INNER JOIN hashtags ON hashtags.id = post_hashtags.hashtag_id INNER JOIN posts ON posts.id = post_hashtags.post_id INNER JOIN threads ON threads.id = posts.thread_id LEFT JOIN profiles ON profiles.user_id = posts.author_user_id WHERE hashtags.tag = ? AND posts.state = 'published' AND posts.visibility = 'public' ORDER BY posts.published_at DESC, posts.id DESC LIMIT 51",
  )
    .bind(tag)
    .all<{
      id: string;
      threadId: string;
      title: string;
      renderedHtml: string;
      publishedAt: string;
      handle: string | null;
    }>();
  return {
    tag,
    posts: rows.results.slice(0, 50),
    next: rows.results.length > 50,
  };
}

export default function TagPage({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-slate-500">标签</p>
      <h1 className="mt-2 text-3xl font-semibold">#{loaderData.tag}</h1>
      <div className="mt-8 grid gap-4">
        {loaderData.posts.map((post) => (
          <article key={post.id} className="rounded-lg border bg-white p-5">
            <Link
              className="font-semibold hover:underline"
              to={`/threads/${post.threadId}#post-${post.id}`}
            >
              {post.title}
            </Link>
            <p className="mt-2 text-sm text-slate-500">
              @{post.handle ?? "远端用户"} · {post.publishedAt}
            </p>
            <div
              className="prose mt-4 max-w-none"
              dangerouslySetInnerHTML={{ __html: post.renderedHtml }}
            />
          </article>
        ))}
        {loaderData.posts.length === 0 ? (
          <p className="text-slate-500">还没有相关内容。</p>
        ) : null}
      </div>
    </main>
  );
}
