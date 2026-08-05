import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/bookmarks";
import {
  canViewForumBoard,
  canViewPrivateForumContent,
} from "@/modules/forum/access.server";
import {
  decodeBookmarkCursor,
  listPostBookmarks,
} from "@/modules/forum/bookmarks";
import { loadForumBoard } from "@/modules/forum/read.server";
import { getSession } from "@/modules/identity/auth.server";
import { loadPostAttachments, mediaObjectPublicUrl } from "@/modules/media";
import { listBookmarkFolders } from "@/modules/forum/p2";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const folderId = new URL(request.url).searchParams.get("folder");
  const error = new URL(request.url).searchParams.get("error");
  const cursor = decodeBookmarkCursor(cursorValue);
  if (cursorValue !== null && !cursor) {
    throw new Response("Invalid cursor", { status: 400 });
  }
  const page = await listPostBookmarks(
    context.cloudflare.env.DB,
    session.user.id,
    cursor,
    folderId,
  );
  const accessCache = new Map<string, Promise<boolean>>();
  const visible = [] as typeof page.results;
  for (const item of page.results) {
    if (item.postVisibility === "public" && item.boardVisibility === "public") {
      visible.push(item);
      continue;
    }
    let allowed = accessCache.get(item.boardId);
    if (!allowed) {
      allowed = (async () => {
        const board = await loadForumBoard(
          context.cloudflare.env.DB,
          item.boardId,
        );
        if (!board) return false;
        const [canView, canViewPrivate] = await Promise.all([
          canViewForumBoard(context.cloudflare.env.DB, board, session.user.id),
          canViewPrivateForumContent(
            context.cloudflare.env.DB,
            board,
            session.user.id,
          ),
        ]);
        return canView && canViewPrivate;
      })();
      accessCache.set(item.boardId, allowed);
    }
    if (await allowed) visible.push(item);
  }
  const attachmentMap = await loadPostAttachments(
    context.cloudflare.env.DB,
    visible.map((item) => item.postId),
  );
  return {
    folders: await listBookmarkFolders(
      context.cloudflare.env.DB,
      session.user.id,
    ),
    bookmarks: visible.map((item) => ({
      ...item,
      attachments: (attachmentMap.get(item.postId) ?? []).map((attachment) => ({
        id: attachment.id,
        url: mediaObjectPublicUrl(
          context.cloudflare.env.APP_ORIGIN,
          attachment.id,
        ),
        name: attachment.originalFilename,
        kind: attachment.kind,
      })),
    })),
    nextCursor: page.nextCursor,
    folderId,
    error,
  };
}

export default function BookmarksPage({ loaderData }: Route.ComponentProps) {
  const folderId = loaderData.folderId;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">保存的帖子</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">收藏</h1>
        </div>
        <Link className="text-sm text-blue-700 hover:underline" to="/">
          返回论坛
        </Link>
      </div>
      <section className="mt-6 rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">收藏夹</h2>
          <Form
            method="post"
            action="/bookmarks/folders"
            className="flex gap-2"
          >
            <input
              type="hidden"
              name="returnTo"
              value={
                folderId
                  ? `/bookmarks?folder=${encodeURIComponent(folderId)}`
                  : "/bookmarks"
              }
            />
            <input
              name="name"
              required
              maxLength={80}
              placeholder="新建文件夹"
              className="rounded-md border px-2 py-1 text-sm"
            />
            <button className="rounded-md border px-3 py-1 text-sm hover:bg-slate-50">
              创建
            </button>
          </Form>
        </div>
        {loaderData.folders.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {loaderData.folders.map((folder) => (
              <Link
                key={folder.id}
                className="rounded-full border px-3 py-1 text-xs hover:bg-slate-50"
                to={`/bookmarks?folder=${folder.id}`}
              >
                {folder.name} ({folder.itemCount})
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      {loaderData.error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {loaderData.error}
        </p>
      ) : null}
      {loaderData.bookmarks.length === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
          还没有收藏帖子。
        </p>
      ) : (
        <ol className="mt-8 space-y-5">
          {loaderData.bookmarks.map((bookmark) => (
            <li key={bookmark.postId} className="rounded-lg border p-5">
              <p className="text-sm text-slate-500">
                {bookmark.authorName ?? bookmark.authorHandle ?? "未署名用户"} ·{" "}
                {bookmark.boardTitle}
              </p>
              <Link
                className="mt-1 block text-lg font-semibold hover:text-blue-700"
                to={`/threads/${bookmark.threadId}#post-${bookmark.postId}`}
              >
                {bookmark.threadTitle}
              </Link>
              <article
                className="prose prose-slate mt-3 max-w-none"
                dangerouslySetInnerHTML={{ __html: bookmark.renderedHtml }}
              />
              {bookmark.attachments.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {bookmark.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.url}
                      className="text-xs text-blue-700 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {attachment.name}
                    </a>
                  ))}
                </div>
              ) : null}
              <Form
                method="post"
                action={`/posts/${bookmark.postId}/bookmark`}
                className="mt-4"
              >
                <input type="hidden" name="bookmarked" value="false" />
                <input
                  type="hidden"
                  name="returnTo"
                  value={
                    folderId
                      ? `/bookmarks?folder=${encodeURIComponent(folderId)}`
                      : "/bookmarks"
                  }
                />
                <button className="text-sm text-slate-600 hover:text-red-700">
                  取消收藏
                </button>
              </Form>
              {loaderData.folders.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {loaderData.folders.map((folder) => (
                    <Form
                      key={folder.id}
                      method="post"
                      action="/bookmarks/folders"
                    >
                      <input type="hidden" name="intent" value="move" />
                      <input
                        type="hidden"
                        name="returnTo"
                        value={
                          folderId
                            ? `/bookmarks?folder=${encodeURIComponent(folderId)}`
                            : "/bookmarks"
                        }
                      />
                      <input type="hidden" name="folderId" value={folder.id} />
                      <input
                        type="hidden"
                        name="postId"
                        value={bookmark.postId}
                      />
                      <input type="hidden" name="add" value="true" />
                      <button className="rounded-full border px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
                        + {folder.name}
                      </button>
                    </Form>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {loaderData.nextCursor ? (
        <Link
          className="mt-5 inline-block text-sm text-blue-700 hover:underline"
          to={`/bookmarks?cursor=${loaderData.nextCursor}`}
        >
          加载更多
        </Link>
      ) : null}
    </main>
  );
}
