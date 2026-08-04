import { and, eq } from "drizzle-orm";
import { Form, Link } from "react-router";

import type { Route } from "./+types/users.$handle";
import { createDatabase } from "@/db/client.server";
import { federationActors, profiles } from "@/db/schema";
import { validateHandle } from "@/modules/identity/handle";
import { personActor } from "@/modules/federation/actor";
import { getSession } from "@/modules/identity/auth.server";
import { isFollowingLocal } from "@/modules/identity/local-follows";

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
    const actor = await createDatabase(
      context.cloudflare.env.DB,
    ).query.federationActors.findFirst({
      where: and(
        eq(federationActors.id, profile.userId),
        eq(federationActors.isLocal, true),
      ),
    });
    if (!actor) throw new Response("Not found", { status: 404 });
    return Response.json(
      personActor(context.cloudflare.env.APP_ORIGIN, {
        ...profile,
        publicKeyPem: actor.publicKeyPem,
      }),
      { headers: { "content-type": "application/activity+json" } },
    );
  }
  const session = await getSession(request, context.cloudflare.env);
  const tab =
    new URL(request.url).searchParams.get("tab") === "replies"
      ? "replies"
      : "posts";
  const [following, counts, activity] = await Promise.all([
    session && session.user.id !== profile.userId
      ? isFollowingLocal(
          context.cloudflare.env.DB,
          session.user.id,
          profile.userId,
        )
      : Promise.resolve(false),
    context.cloudflare.env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM local_follows WHERE following_user_id = ?) AS followers, (SELECT COUNT(*) FROM local_follows WHERE follower_user_id = ?) AS following",
    )
      .bind(profile.userId, profile.userId)
      .first<{ followers: number; following: number }>(),
    context.cloudflare.env.DB.prepare(
      `SELECT posts.id AS postId, posts.thread_id AS threadId, posts.rendered_html AS renderedHtml,
                posts.parent_post_id AS parentPostId, posts.published_at AS publishedAt,
                threads.title AS threadTitle
         FROM posts
         INNER JOIN threads ON threads.id = posts.thread_id
         INNER JOIN boards ON boards.id = threads.board_id
         WHERE posts.author_user_id = ? AND posts.state = 'published' AND posts.visibility = 'public'
           AND boards.visibility = 'public' ${tab === "replies" ? "AND posts.parent_post_id IS NOT NULL" : ""}
         ORDER BY posts.published_at DESC, posts.id DESC LIMIT 30`,
    )
      .bind(profile.userId)
      .all<{
        postId: string;
        threadId: string;
        renderedHtml: string;
        parentPostId: string | null;
        publishedAt: string;
        threadTitle: string;
      }>(),
  ]);
  return {
    profile,
    session,
    tab,
    following,
    counts: {
      followers: Number(counts?.followers ?? 0),
      following: Number(counts?.following ?? 0),
    },
    activity: activity.results,
  };
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
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <span>{loaderData.counts.followers} 位关注者</span>
        <span>{loaderData.counts.following} 个关注中</span>
        {loaderData.session && loaderData.session.user.id !== profile.userId ? (
          <Form method="post" action={`/users/${profile.handle}/follow`}>
            <input
              type="hidden"
              name="following"
              value={String(!loaderData.following)}
            />
            <button className="rounded-md border px-3 py-1.5 hover:bg-slate-50">
              {loaderData.following ? "取消关注" : "关注"}
            </button>
          </Form>
        ) : null}
      </div>
      <nav className="mt-8 flex gap-4 border-b text-sm" aria-label="用户内容">
        <Link
          className={
            loaderData.tab === "posts"
              ? "border-b-2 border-slate-950 pb-3 font-medium"
              : "pb-3 text-slate-500"
          }
          to={`/users/${profile.handle}`}
        >
          动态
        </Link>
        <Link
          className={
            loaderData.tab === "replies"
              ? "border-b-2 border-slate-950 pb-3 font-medium"
              : "pb-3 text-slate-500"
          }
          to={`/users/${profile.handle}?tab=replies`}
        >
          回复
        </Link>
        <Link
          className="pb-3 text-slate-500"
          to={`/users/${profile.handle}/followers`}
        >
          关注者
        </Link>
        <Link
          className="pb-3 text-slate-500"
          to={`/users/${profile.handle}/following`}
        >
          关注中
        </Link>
      </nav>
      {loaderData.activity.length > 0 ? (
        <ol className="mt-6 space-y-4">
          {loaderData.activity.map((item) => (
            <li key={item.postId} className="rounded-lg border p-4">
              <Link
                className="text-sm font-medium hover:text-blue-700"
                to={`/threads/${item.threadId}#post-${item.postId}`}
              >
                {item.threadTitle}
              </Link>
              <article
                className="prose prose-slate mt-3 max-w-none"
                dangerouslySetInnerHTML={{ __html: item.renderedHtml }}
              />
              <time
                className="mt-3 block text-xs text-slate-500"
                dateTime={item.publishedAt}
              >
                {item.publishedAt.slice(0, 16).replace("T", " ")}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-8 text-sm text-slate-500">暂无公开内容。</p>
      )}
      <Link to="/" className="mt-10 inline-block text-sm underline">
        返回 CFBBS
      </Link>
    </main>
  );
}
