import { Form, Link, data, redirect, useActionData } from "react-router";

import type { Route } from "./+types/threads.$threadId";
import {
  canReplyInForumBoard,
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import { validateReplyInput } from "@/modules/forum/input";
import {
  listForumThreadPosts,
  loadForumBoard,
  loadForumThread,
} from "@/modules/forum/read.server";
import { createReply } from "@/modules/forum/posts/service";
import { getSession } from "@/modules/identity/auth.server";

async function threadPageData(request: Request, env: Env, threadId: string) {
  const thread = await loadForumThread(env.DB, threadId);
  if (!thread) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(env.DB, thread.boardId);
  if (!board) throw new Response("Not found", { status: 404 });

  const session = await getSession(request, env);
  const userId = session?.user.id ?? null;
  const [canViewBoard, canViewPrivate, canReply] = await Promise.all([
    canViewForumBoard(env.DB, board, userId),
    canViewPrivateForumContent(env.DB, board, userId),
    canReplyInForumBoard(env.DB, board, userId),
  ]);
  if (
    !canViewBoard ||
    (thread.firstPostVisibility === "private" && !canViewPrivate)
  ) {
    throw new Response("Not found", { status: 404 });
  }
  const posts = await listForumThreadPosts(
    env.DB,
    thread.id,
    board.visibility === "private" || canViewPrivate,
    userId,
  );
  return { board, thread, posts: posts.results, session, canReply };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  return threadPageData(request, context.cloudflare.env, params.threadId ?? "");
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");

  const thread = await loadForumThread(
    context.cloudflare.env.DB,
    params.threadId ?? "",
  );
  if (!thread) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(context.cloudflare.env.DB, thread.boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  const [canView, canViewPrivate, canReply] = await Promise.all([
    canViewForumBoard(context.cloudflare.env.DB, board, session.user.id),
    canViewPrivateForumContent(
      context.cloudflare.env.DB,
      board,
      session.user.id,
    ),
    canReplyInForumBoard(context.cloudflare.env.DB, board, session.user.id),
  ]);
  if (
    !canView ||
    (thread.firstPostVisibility === "private" && !canViewPrivate)
  ) {
    throw new Response("Not found", { status: 404 });
  }
  if (!canReply || thread.isLocked) {
    throw new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const input = validateReplyInput({
    markdown: String(form.get("markdown") ?? ""),
  });
  if (!input.ok) return data({ error: input.message }, { status: 400 });

  const visibility =
    board.visibility === "private" || thread.firstPostVisibility === "private"
      ? "private"
      : "public";
  await createReply(context.cloudflare.env.DB, {
    postId: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    threadId: thread.id,
    parentPostId: thread.firstPostId,
    authorUserId: session.user.id,
    markdown: input.value.markdown,
    visibility,
    ...(visibility === "public"
      ? {
          federation: {
            eventId: crypto.randomUUID(),
            actorId: session.user.id,
            origin: context.cloudflare.env.APP_ORIGIN,
          },
        }
      : {}),
  });
  return redirect(`/threads/${thread.id}`);
}

export default function ThreadPage({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { board, thread, posts, session, canReply } = loaderData;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm text-slate-500">
        <Link
          className="hover:text-blue-700 hover:underline"
          to={`/boards/${board.id}`}
        >
          {board.title}
        </Link>
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        {thread.title}
      </h1>
      {thread.isLocked ? (
        <p className="mt-3 text-sm text-amber-700">本主题已锁定。</p>
      ) : null}

      <ol className="mt-8 space-y-6">
        {posts.map((post) => (
          <li
            id={`post-${post.id}`}
            key={post.id}
            className="rounded-lg border p-5"
          >
            <p className="text-sm text-slate-500">
              {post.authorActorUri ? (
                <a className="hover:underline" href={post.authorActorUri}>
                  {post.authorName ?? post.authorActorUri}
                </a>
              ) : post.authorHandle ? (
                <Link
                  className="hover:underline"
                  to={`/users/${post.authorHandle}`}
                >
                  {post.authorName ?? `@${post.authorHandle}`}
                </Link>
              ) : (
                "未署名用户"
              )}
              <time className="ml-3" dateTime={post.publishedAt}>
                {post.publishedAt.slice(0, 16).replace("T", " ")}
              </time>
            </p>
            <article
              className="prose prose-slate mt-4 max-w-none"
              dangerouslySetInnerHTML={{ __html: post.renderedHtml }}
            />
            {post.parentPostId ? (
              <p className="mt-4 text-xs text-slate-500">
                回复 #{post.parentPostId}
              </p>
            ) : null}
            {session ? (
              <div className="mt-4 flex items-start gap-4">
                <Form method="post" action={`/posts/${post.id}/like`}>
                  <button className="text-sm text-slate-600 hover:text-blue-700">
                    {post.viewerLiked ? "取消点赞" : "点赞"}（{post.likeCount}）
                  </button>
                </Form>
                <details className="text-sm text-slate-500">
                  <summary className="cursor-pointer hover:text-slate-900">
                    举报
                  </summary>
                  <Form
                    method="post"
                    action={`/posts/${post.id}/report`}
                    className="mt-3 grid w-72 gap-2"
                  >
                    <label className="grid gap-1 text-xs">
                      原因
                      <textarea
                        required
                        name="reason"
                        maxLength={2000}
                        rows={3}
                        className="rounded-md border px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button className="w-fit rounded-md border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                      提交举报
                    </button>
                  </Form>
                </details>
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-500">
                点赞 {post.likeCount}
              </p>
            )}
          </li>
        ))}
      </ol>

      {canReply && !thread.isLocked ? (
        <section className="mt-8 rounded-lg border p-5">
          <h2 className="font-semibold">回复主题</h2>
          {actionData?.error ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {actionData.error}
            </p>
          ) : null}
          <Form method="post" className="mt-4 grid gap-4">
            <label className="grid gap-1 text-sm font-medium">
              内容（Markdown）
              <textarea
                required
                name="markdown"
                maxLength={20_000}
                rows={7}
                className="rounded-md border px-3 py-2 font-normal"
              />
            </label>
            <button className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              发表回复
            </button>
          </Form>
        </section>
      ) : session ? (
        <p className="mt-8 text-sm text-slate-500">
          您没有在此主题回复的权限。
        </p>
      ) : (
        <p className="mt-8 text-sm text-slate-500">
          <Link className="text-blue-700 hover:underline" to="/auth/login">
            登录
          </Link>
          后可参与讨论。
        </p>
      )}
    </main>
  );
}
