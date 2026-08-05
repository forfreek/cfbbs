import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { useState } from "react";

import type { Route } from "./+types/boards.$boardId";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  canCreateForumThread,
  canViewForumBoard,
  canViewPrivateForumContent,
  isForumBoardWithinPrivateTree,
} from "@/modules/forum/access.server";
import { validateThreadInput } from "@/modules/forum/input";
import {
  decodeForumThreadCursor,
  listForumBoardThreads,
  loadForumBoard,
} from "@/modules/forum/read.server";
import { createThread } from "@/modules/forum/threads/service";
import { validatePollInput } from "@/modules/forum/content";
import {
  getSession,
  requireVerifiedSession,
} from "@/modules/identity/auth.server";
import { validateAttachmentIds } from "@/modules/media";
import {
  consumeRateLimit,
  rateLimitResponse,
  rateLimitRules,
} from "@/modules/rate-limit.server";
import { draftStorageKey } from "@/components/draft-storage";
import { resolveQuoteTarget } from "@/modules/forum/quotes";

async function boardPageData(request: Request, env: Env, boardId: string) {
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeForumThreadCursor(cursorValue);
  if (cursorValue !== null && !cursor) {
    throw new Response("Invalid cursor", { status: 400 });
  }

  const board = await loadForumBoard(env.DB, boardId);
  if (!board) throw new Response("Not found", { status: 404 });

  const session = await getSession(request, env);
  const userId = session?.user.id ?? null;
  if (!(await canViewForumBoard(env.DB, board, userId))) {
    throw new Response("Not found", { status: 404 });
  }
  const [canViewPrivate, canCreate, boardIsPrivate] = await Promise.all([
    canViewPrivateForumContent(env.DB, board, userId),
    canCreateForumThread(env.DB, board, userId),
    isForumBoardWithinPrivateTree(env.DB, board.id),
  ]);
  const threads = await listForumBoardThreads(
    env.DB,
    board.id,
    boardIsPrivate || canViewPrivate,
    cursor,
  );
  return {
    board,
    session,
    canCreate: canCreate && Boolean(session?.user.emailVerified),
    requiresVerification: Boolean(session && !session.user.emailVerified),
    threads,
  };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  return boardPageData(request, context.cloudflare.env, params.boardId ?? "");
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const boardId = params.boardId ?? "";
  const session = await requireVerifiedSession(
    request,
    context.cloudflare.env,
  ).catch((error) => {
    if (error instanceof Response && error.status === 401) {
      throw redirect("/auth/login");
    }
    throw error;
  });

  const board = await loadForumBoard(context.cloudflare.env.DB, boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  if (
    !(await canViewForumBoard(
      context.cloudflare.env.DB,
      board,
      session.user.id,
    ))
  ) {
    throw new Response("Not found", { status: 404 });
  }
  if (
    !(await canCreateForumThread(
      context.cloudflare.env.DB,
      board,
      session.user.id,
    ))
  ) {
    throw new Response("Forbidden", { status: 403 });
  }
  const boardIsPrivate = await isForumBoardWithinPrivateTree(
    context.cloudflare.env.DB,
    board.id,
  );
  const limited = await consumeRateLimit(context.cloudflare.env.FEDIFY_KV, {
    scope: "write",
    subject: session.user.id,
    rule: rateLimitRules.write,
  });
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const form = await request.formData();
  const input = validateThreadInput({
    title: String(form.get("title") ?? ""),
    markdown: String(form.get("markdown") ?? ""),
  });
  if (!input.ok) return data({ error: input.message }, { status: 400 });
  const attachments = validateAttachmentIds(form.getAll("attachmentIds"));
  if (!attachments.ok)
    return data({ error: attachments.message }, { status: 400 });
  const rawPollOptions = form
    .getAll("pollOptions")
    .map(String)
    .filter((value) => value.trim());
  const poll = rawPollOptions.length
    ? validatePollInput({
        options: rawPollOptions,
        multiple: form.get("pollMultiple") === "true",
        closesAt: String(form.get("pollClosesAt") || "") || null,
      })
    : null;
  if (poll && !poll.ok) return data({ error: poll.message }, { status: 400 });
  const rawQuoteUri = String(form.get("quoteUri") ?? "").trim();
  const rawQuotePostId = String(form.get("quotePostId") ?? "").trim();
  const quote = rawQuoteUri
    ? await resolveQuoteTarget(context.cloudflare.env.DB, {
        targetPostId: rawQuotePostId || null,
        targetUri: rawQuoteUri,
      })
    : null;
  if (quote && !quote.ok)
    return data({ error: quote.message }, { status: 400 });

  const threadId = String(form.get("threadId") || crypto.randomUUID());
  const postId = String(form.get("postId") || crypto.randomUUID());
  try {
    await createThread(context.cloudflare.env.DB, {
      threadId,
      postId,
      revisionId: crypto.randomUUID(),
      boardId: board.id,
      authorUserId: session.user.id,
      title: input.value.title,
      markdown: input.value.markdown,
      attachmentIds: attachments.ids,
      visibility: boardIsPrivate ? "private" : "public",
      ...(poll?.ok ? { poll: poll.value } : {}),
      ...(quote?.ok ? { quote: quote.quote } : {}),
      ...(!boardIsPrivate
        ? {
            federation: {
              eventId: crypto.randomUUID(),
              actorId: session.user.id,
              origin: context.cloudflare.env.APP_ORIGIN,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error("Create thread failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return data(
      {
        error:
          error instanceof Error ? error.message : "发布主题失败，请稍后重试。",
      },
      { status: 400 },
    );
  }
  return redirect(`/threads/${threadId}`);
}

export default function BoardPage({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const { board, session, canCreate, requiresVerification, threads } =
    loaderData;
  const [title, setTitle] = useState("");
  const [threadSubmissionId] = useState(() => crypto.randomUUID());
  const [postSubmissionId] = useState(() => crypto.randomUUID());
  const navigation = useNavigation();
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-sm text-slate-500">板块</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {board.title}
      </h1>
      {board.description ? (
        <p className="mt-3 text-slate-600">{board.description}</p>
      ) : null}

      {requiresVerification ? (
        <p className="mt-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          请先验证邮箱后再发布主题。{" "}
          <Link
            className="font-medium underline"
            to={`/auth/verify?email=${encodeURIComponent(session?.user.email ?? "")}`}
          >
            重发验证邮件
          </Link>
        </p>
      ) : canCreate ? (
        <section id="create-thread" className="mt-10 rounded-lg border p-5">
          <h2 className="font-semibold">发布主题</h2>
          {actionData?.error ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {actionData.error}
            </p>
          ) : null}
          <Form method="post" className="mt-4 grid gap-4">
            <input type="hidden" name="threadId" value={threadSubmissionId} />
            <input type="hidden" name="postId" value={postSubmissionId} />
            <label className="grid gap-1 text-sm font-medium">
              标题
              <input
                required
                name="title"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                className="rounded-md border px-3 py-2 font-normal"
              />
            </label>
            <MarkdownEditor
              draftKey={draftStorageKey(
                session?.user.id,
                `new-thread:${board.id}`,
              )}
              draftTitle={title}
              onDraftTitleChange={setTitle}
            />
            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer font-medium">添加投票</summary>
              <div className="mt-3 grid gap-2">
                <input
                  name="pollOptions"
                  placeholder="选项 1"
                  className="rounded-md border px-2 py-1.5"
                />
                <input
                  name="pollOptions"
                  placeholder="选项 2"
                  className="rounded-md border px-2 py-1.5"
                />
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="pollMultiple" value="true" />
                  允许多选
                </label>
                <label className="grid gap-1">
                  截止时间
                  <input
                    type="datetime-local"
                    name="pollClosesAt"
                    className="rounded-md border px-2 py-1.5"
                  />
                </label>
              </div>
            </details>
            <button
              disabled={navigation.state !== "idle"}
              className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
            >
              {navigation.state === "submitting" ? "正在发布…" : "发布主题"}
            </button>
          </Form>
        </section>
      ) : session ? (
        <p className="mt-8 text-sm text-slate-500">
          您没有在此板块发布主题的权限。
        </p>
      ) : (
        <p className="mt-8 text-sm text-slate-500">
          <Link className="text-blue-700 hover:underline" to="/auth/login">
            登录
          </Link>
          后可参与讨论。
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">主题</h2>
        {threads.results.length > 0 ? (
          <ol className="mt-4 divide-y border-y">
            {threads.results.map((thread) => (
              <li key={thread.id} className="py-4">
                <Link
                  className="font-medium hover:text-blue-700"
                  to={`/threads/${thread.id}`}
                >
                  {thread.title}
                </Link>
                <p className="mt-1 text-sm text-slate-500">
                  {thread.authorName ?? thread.authorHandle ?? "未署名用户"} ·{" "}
                  {thread.replyCount} 条回复 ·{" "}
                  {thread.activityAt.slice(0, 16).replace("T", " ")}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-slate-500">暂无可见主题。</p>
        )}
        {threads.nextCursor ? (
          <Link
            className="mt-4 inline-block text-sm text-blue-700 hover:underline"
            to={`?cursor=${threads.nextCursor}`}
          >
            加载更多主题
          </Link>
        ) : null}
      </section>
    </main>
  );
}
