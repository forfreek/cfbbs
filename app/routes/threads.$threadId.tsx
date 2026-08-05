import {
  Form,
  Link,
  data,
  redirect,
  useActionData,
  useNavigation,
} from "react-router";
import { useState } from "react";

import type { Route } from "./+types/threads.$threadId";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  canReplyInForumBoard,
  canViewForumBoard,
  canViewPrivateForumContent,
  isForumBoardWithinPrivateTree,
} from "@/modules/forum/access.server";
import { validateReplyInput } from "@/modules/forum/input";
import {
  decodeForumPostCursor,
  listForumThreadPosts,
  loadForumBoard,
  loadForumThread,
} from "@/modules/forum/read.server";
import { createReply } from "@/modules/forum/posts/service";
import {
  loadPostAttachments,
  loadRemoteObjectAttachments,
  mediaObjectPublicUrl,
  remoteAttachmentsToView,
  validateAttachmentIds,
} from "@/modules/media";
import {
  getSession,
  requireVerifiedSession,
} from "@/modules/identity/auth.server";
import { loadThreadSubscription } from "@/modules/forum/subscriptions";
import { MediaGallery } from "@/components/media-gallery";
import { draftStorageKey } from "@/components/draft-storage";
import { authorizeDatabase } from "@/modules/permissions/authorization.server";
import {
  consumeRateLimit,
  rateLimitResponse,
  rateLimitRules,
} from "@/modules/rate-limit.server";
import { validatePollInput } from "@/modules/forum/content";
import { resolveQuoteTarget } from "@/modules/forum/quotes";
import { listReactionSummary, loadPollView } from "@/modules/forum/p2";

async function threadPageData(request: Request, env: Env, threadId: string) {
  const thread = await loadForumThread(env.DB, threadId);
  if (!thread) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(env.DB, thread.boardId);
  if (!board) throw new Response("Not found", { status: 404 });

  const session = await getSession(request, env);
  const userId = session?.user.id ?? null;
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeForumPostCursor(cursorValue);
  if (cursorValue !== null && !cursor) {
    throw new Response("Invalid cursor", { status: 400 });
  }
  const [
    canViewBoard,
    canViewPrivate,
    canReplyPermission,
    boardIsPrivate,
    editAny,
    deleteAny,
    canPin,
    canLock,
    subscription,
  ] = await Promise.all([
    canViewForumBoard(env.DB, board, userId),
    canViewPrivateForumContent(env.DB, board, userId),
    canReplyInForumBoard(env.DB, board, userId),
    isForumBoardWithinPrivateTree(env.DB, board.id),
    authorizeDatabase(env.DB, {
      userId,
      permission: "posts.edit_any",
      boardId: board.id,
    }),
    authorizeDatabase(env.DB, {
      userId,
      permission: "posts.delete_any",
      boardId: board.id,
    }),
    authorizeDatabase(env.DB, {
      userId,
      permission: "threads.pin",
      boardId: board.id,
    }),
    authorizeDatabase(env.DB, {
      userId,
      permission: "threads.lock",
      boardId: board.id,
    }),
    userId
      ? loadThreadSubscription(env.DB, userId, thread.id)
      : Promise.resolve(null),
  ]);
  const canReply = canReplyPermission && Boolean(session?.user.emailVerified);
  const requiresVerification = Boolean(session && !session.user.emailVerified);
  if (
    !canViewBoard ||
    (thread.firstPostVisibility === "private" && !canViewPrivate)
  ) {
    throw new Response("Not found", { status: 404 });
  }
  const posts = await listForumThreadPosts(
    env.DB,
    thread.id,
    boardIsPrivate || canViewPrivate,
    userId,
    cursor,
  );
  const attachmentMap = await loadPostAttachments(
    env.DB,
    posts.results.map((post) => post.id),
  );
  const remoteObjectUris = posts.results
    .map((post) => post.federationObjectId)
    .filter((value): value is string => Boolean(value));
  const remoteAttachmentMap = await loadRemoteObjectAttachments(
    env.DB,
    remoteObjectUris,
  );
  const postsWithAttachments = await Promise.all(
    posts.results.map(async (post) => {
      const local = (attachmentMap.get(post.id) ?? []).map((item) => ({
        id: item.id,
        url: mediaObjectPublicUrl(env.APP_ORIGIN, item.id),
        contentType: item.contentType,
        originalFilename: item.originalFilename,
        kind: item.kind as "image" | "document",
        byteSize: item.byteSize,
      }));
      const remote = post.federationObjectId
        ? remoteAttachmentsToView(
            remoteAttachmentMap.get(post.federationObjectId) ?? [],
          )
        : [];
      const [poll, reactions, quote] = await Promise.all([
        loadPollView(env.DB, post.id, userId),
        listReactionSummary(env.DB, post.id, userId),
        env.DB.prepare(
          "SELECT target_uri AS targetUri FROM post_quotes WHERE post_id = ? LIMIT 1",
        )
          .bind(post.id)
          .first<{ targetUri: string }>(),
      ]);
      return {
        ...post,
        attachments: [...local, ...remote],
        poll,
        reactions,
        quoteUri: quote?.targetUri ?? null,
      };
    }),
  );
  return {
    board,
    thread,
    posts: postsWithAttachments,
    nextCursor: posts.nextCursor ?? null,
    session,
    canReply,
    requiresVerification,
    canEditAny: editAny.allowed,
    canDeleteAny: deleteAny.allowed,
    canPin: canPin.allowed,
    canLock: canLock.allowed,
    subscription,
  };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  return threadPageData(request, context.cloudflare.env, params.threadId ?? "");
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const session = await requireVerifiedSession(
    request,
    context.cloudflare.env,
  ).catch((error) => {
    if (error instanceof Response && error.status === 401) {
      throw redirect("/auth/login");
    }
    throw error;
  });

  const thread = await loadForumThread(
    context.cloudflare.env.DB,
    params.threadId ?? "",
  );
  if (!thread) throw new Response("Not found", { status: 404 });
  const board = await loadForumBoard(context.cloudflare.env.DB, thread.boardId);
  if (!board) throw new Response("Not found", { status: 404 });
  const [canView, canViewPrivate, canReply, boardIsPrivate] = await Promise.all(
    [
      canViewForumBoard(context.cloudflare.env.DB, board, session.user.id),
      canViewPrivateForumContent(
        context.cloudflare.env.DB,
        board,
        session.user.id,
      ),
      canReplyInForumBoard(context.cloudflare.env.DB, board, session.user.id),
      isForumBoardWithinPrivateTree(context.cloudflare.env.DB, board.id),
    ],
  );
  if (
    !canView ||
    (thread.firstPostVisibility === "private" && !canViewPrivate)
  ) {
    throw new Response("Not found", { status: 404 });
  }
  if (!canReply || thread.isLocked) {
    throw new Response("Forbidden", { status: 403 });
  }
  const limited = await consumeRateLimit(context.cloudflare.env.FEDIFY_KV, {
    scope: "write",
    subject: session.user.id,
    rule: rateLimitRules.write,
  });
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);

  const form = await request.formData();
  const input = validateReplyInput({
    markdown: String(form.get("markdown") ?? ""),
  });
  if (!input.ok) return data({ error: input.message }, { status: 400 });
  const attachments = validateAttachmentIds(form.getAll("attachmentIds"));
  if (!attachments.ok) {
    return data({ error: attachments.message }, { status: 400 });
  }
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

  const rawReplyTo = String(form.get("replyTo") ?? "");
  const replyTo = rawReplyTo || thread.firstPostId;
  const parent = await context.cloudflare.env.DB.prepare(
    "SELECT id, thread_id AS threadId, state, visibility FROM posts WHERE id = ? LIMIT 1",
  )
    .bind(replyTo)
    .first<{
      id: string;
      threadId: string;
      state: string;
      visibility: string;
    }>();
  if (
    !parent ||
    parent.threadId !== thread.id ||
    parent.state !== "published" ||
    (parent.visibility === "private" && !canViewPrivate)
  ) {
    return data({ error: "回复目标不可用。" }, { status: 400 });
  }
  const visibility =
    boardIsPrivate || thread.firstPostVisibility === "private"
      ? "private"
      : "public";
  const postId = String(form.get("postId") || crypto.randomUUID());
  try {
    await createReply(context.cloudflare.env.DB, {
      postId,
      revisionId: crypto.randomUUID(),
      threadId: thread.id,
      parentPostId: replyTo,
      authorUserId: session.user.id,
      markdown: input.value.markdown,
      attachmentIds: attachments.ids,
      visibility,
      ...(poll?.ok ? { poll: poll.value } : {}),
      ...(quote?.ok ? { quote: quote.quote } : {}),
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
  } catch (error) {
    console.error("Create reply failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return data(
      {
        error:
          error instanceof Error ? error.message : "回复失败，请稍后重试。",
      },
      { status: 400 },
    );
  }
  return redirect(`/threads/${thread.id}`);
}

export default function ThreadPage({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const {
    board,
    thread,
    posts,
    session,
    canReply,
    requiresVerification,
    canEditAny,
    canDeleteAny,
    canPin,
    canLock,
    subscription,
  } = loaderData;
  const [replyTo, setReplyTo] = useState<string>(thread.firstPostId);
  const [quoteTarget, setQuoteTarget] = useState<{
    postId: string;
    uri: string;
    title: string;
  } | null>(null);
  const [submissionId] = useState(() => crypto.randomUUID());
  const navigation = useNavigation();
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
      {thread.isPinned ? (
        <p className="mt-2 text-sm text-blue-700">本主题已置顶。</p>
      ) : null}
      {session ? (
        <Form
          method="post"
          action={`/threads/${thread.id}/subscription`}
          className="mt-4 flex flex-wrap items-center gap-2 text-sm"
        >
          <select
            name="mode"
            defaultValue={subscription?.mode ?? "none"}
            className="rounded-md border px-2 py-1"
          >
            <option value="none">不订阅</option>
            <option value="all">订阅全部回复</option>
            <option value="mentions">仅被提及时</option>
          </select>
          <button className="rounded-md border px-3 py-1.5 hover:bg-slate-50">
            保存订阅
          </button>
          <Link
            className="text-slate-500 hover:underline"
            to="/settings/notifications"
          >
            管理通知设置
          </Link>
        </Form>
      ) : null}
      {session && (canPin || canLock) ? (
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {canPin ? (
            <Form method="post" action={`/threads/${thread.id}/moderation`}>
              <input
                type="hidden"
                name="intent"
                value={thread.isPinned ? "unpin" : "pin"}
              />
              <button className="rounded-md border px-3 py-1.5 hover:bg-slate-50">
                {thread.isPinned ? "取消置顶" : "置顶主题"}
              </button>
            </Form>
          ) : null}
          {canLock ? (
            <Form method="post" action={`/threads/${thread.id}/moderation`}>
              <input
                type="hidden"
                name="intent"
                value={thread.isLocked ? "unlock" : "lock"}
              />
              <button className="rounded-md border px-3 py-1.5 hover:bg-slate-50">
                {thread.isLocked ? "解除锁定" : "锁定主题"}
              </button>
            </Form>
          ) : null}
        </div>
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
            <MediaGallery attachments={post.attachments ?? []} />
            {post.quoteUri ? (
              <a
                className="mt-4 block rounded-md border bg-slate-50 p-3 text-sm text-blue-700 hover:underline"
                href={post.quoteUri}
                rel="nofollow noopener"
                target="_blank"
              >
                引用：{post.quoteUri}
              </a>
            ) : null}
            {post.poll ? (
              <Form
                method="post"
                action={`/posts/${post.id}/poll/vote`}
                className="mt-4 rounded-md border p-4"
              >
                <p className="text-sm font-medium">
                  投票
                  {post.poll.closesAt
                    ? ` · 截止 ${post.poll.closesAt.slice(0, 16).replace("T", " ")}`
                    : ""}
                </p>
                <div className="mt-3 grid gap-2">
                  {post.poll.options.map((option) => (
                    <label
                      key={option.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type={post.poll?.multiple ? "checkbox" : "radio"}
                        name="optionIds"
                        value={option.id}
                        disabled={!session || post.poll?.hasVoted}
                      />
                      <span>{option.label}</span>
                      {post.poll?.hasVoted ? (
                        <span className="text-slate-500">({option.votes})</span>
                      ) : null}
                    </label>
                  ))}
                </div>
                {session && !post.poll.hasVoted ? (
                  <button className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50">
                    投票
                  </button>
                ) : null}
                {!session ? (
                  <p className="mt-3 text-xs text-slate-500">登录后参与投票</p>
                ) : null}
              </Form>
            ) : null}
            {post.parentPostId ? (
              <p className="mt-4 text-xs text-slate-500">
                回复{" "}
                <a
                  className="text-blue-700 hover:underline"
                  href={`/threads/${thread.id}#post-${post.parentPostId}`}
                >
                  #{post.parentPostId.slice(0, 8)}
                </a>
              </p>
            ) : null}
            {post.parentPostId && post.parentRenderedHtml ? (
              <a
                href={`#post-${post.parentPostId}`}
                className="mt-3 block rounded-md border-l-2 border-slate-300 bg-slate-50 p-3 text-sm text-slate-600"
              >
                <span className="font-medium">
                  {post.parentAuthorName ?? post.parentAuthorHandle ?? "父回复"}
                </span>
                <span
                  className="ml-2 line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: post.parentRenderedHtml }}
                />
              </a>
            ) : null}
            {post.parentPostId && !post.parentRenderedHtml ? (
              <p className="mt-3 text-xs text-slate-500">父回复不可见</p>
            ) : null}
            {session ? (
              <div className="mt-4 flex items-start gap-4">
                <Form method="post" action={`/posts/${post.id}/like`}>
                  <button className="text-sm text-slate-600 hover:text-blue-700">
                    {post.viewerLiked ? "取消点赞" : "点赞"}（{post.likeCount}）
                  </button>
                </Form>
                <Form method="post" action={`/posts/${post.id}/bookmark`}>
                  <input
                    type="hidden"
                    name="bookmarked"
                    value={String(!post.viewerBookmarked)}
                  />
                  <button className="text-sm text-slate-600 hover:text-blue-700">
                    {post.viewerBookmarked ? "取消收藏" : "收藏"}
                  </button>
                </Form>
                <div className="flex flex-wrap gap-1">
                  {(post.reactions ?? []).map((reaction) => (
                    <Form
                      key={reaction.emoji}
                      method="post"
                      action={`/posts/${post.id}/react`}
                    >
                      <input
                        type="hidden"
                        name="emoji"
                        value={reaction.emoji}
                      />
                      <button
                        className={`rounded-full border px-2 py-0.5 text-xs ${reaction.viewerReacted ? "bg-orange-50" : ""}`}
                        title="切换反应"
                      >
                        {reaction.emoji} {reaction.count}
                      </button>
                    </Form>
                  ))}
                  <Form method="post" action={`/posts/${post.id}/react`}>
                    <input type="hidden" name="emoji" value="👍" />
                    <button
                      className="rounded-full border px-2 py-0.5 text-xs"
                      title="添加赞"
                    >
                      👍
                    </button>
                  </Form>
                </div>
                <Form method="post" action={`/posts/${post.id}/boost`}>
                  <button className="text-sm text-slate-600 hover:text-blue-700">
                    Boost
                  </button>
                </Form>
                <button
                  type="button"
                  disabled={!post.federationObjectId}
                  className="text-sm text-slate-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    if (!post.federationObjectId) return;
                    setQuoteTarget({
                      postId: post.id,
                      uri: post.federationObjectId,
                      title: thread.title,
                    });
                    setReplyTo(post.id);
                    document
                      .getElementById("reply-composer")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  引用
                </button>
                <button
                  type="button"
                  className="text-sm text-slate-600 hover:text-blue-700"
                  onClick={() => {
                    setReplyTo(post.id);
                    document
                      .getElementById("reply-composer")
                      ?.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  回复
                </button>
                {post.authorUserId !== null &&
                (post.authorUserId === session.user.id || canEditAny) ? (
                  <Link
                    className="text-sm text-slate-600 hover:text-blue-700"
                    to={`/posts/${post.id}/edit`}
                  >
                    编辑
                  </Link>
                ) : null}
                {post.authorUserId !== null &&
                (post.authorUserId === session.user.id || canDeleteAny) ? (
                  <Form method="post" action={`/posts/${post.id}/delete`}>
                    <button className="text-sm text-red-700 hover:text-red-900">
                      删除
                    </button>
                  </Form>
                ) : null}
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
      {loaderData.nextCursor ? (
        <Link
          className="mt-5 inline-block text-sm text-blue-700 hover:underline"
          to={`/threads/${thread.id}?cursor=${loaderData.nextCursor}`}
        >
          加载更多回复
        </Link>
      ) : null}

      {requiresVerification ? (
        <p className="mt-8 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          请先验证邮箱后再回复或发起联邦互动。{" "}
          <Link
            className="font-medium underline"
            to={`/auth/verify?email=${encodeURIComponent(session?.user.email ?? "")}`}
          >
            重发验证邮件
          </Link>
        </p>
      ) : canReply && !thread.isLocked ? (
        <section className="mt-8 rounded-lg border p-5">
          <h2 className="font-semibold">回复主题</h2>
          {actionData?.error ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {actionData.error}
            </p>
          ) : null}
          <Form method="post" id="reply-composer" className="mt-4 grid gap-4">
            <input type="hidden" name="postId" value={submissionId} />
            <input type="hidden" name="replyTo" value={replyTo} />
            {quoteTarget ? (
              <>
                <input
                  type="hidden"
                  name="quotePostId"
                  value={quoteTarget.postId}
                />
                <input type="hidden" name="quoteUri" value={quoteTarget.uri} />
                <p className="rounded-md border-l-2 border-blue-400 bg-slate-50 p-3 text-sm text-slate-600">
                  正在引用“{quoteTarget.title}”中的公开内容。{" "}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => setQuoteTarget(null)}
                  >
                    取消引用
                  </button>
                </p>
              </>
            ) : null}
            {replyTo !== thread.firstPostId ? (
              <p className="text-sm text-slate-500">
                正在回复 #{replyTo.slice(0, 8)}{" "}
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => setReplyTo(thread.firstPostId)}
                >
                  取消指定
                </button>
              </p>
            ) : null}
            <MarkdownEditor
              label="内容（Markdown）"
              rows={7}
              draftKey={draftStorageKey(session?.user.id, `reply:${thread.id}`)}
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
              {navigation.state === "submitting" ? "正在发表…" : "发表回复"}
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
