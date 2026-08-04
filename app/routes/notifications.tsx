import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/notifications";
import {
  canViewPrivateForumContent,
  isForumBoardWithinPrivateTree,
} from "@/modules/forum/access.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import {
  listNotifications,
  decodeNotificationCursor,
  markAllNotificationsRead,
  markNotificationRead,
  notificationForViewer,
  type StoredNotification,
} from "@/modules/forum/notifications/read.server";
import { getSession } from "@/modules/identity/auth.server";

function notificationLabel(type: StoredNotification["type"]) {
  if (type === "reply") return "回复了你的主题";
  if (type === "like") return "赞了你的帖子";
  if (type === "mention") return "提到了你";
  if (type === "thread-reply") return "更新了你订阅的主题";
  return "关注了你";
}

async function authorizeNotification(
  database: D1Database,
  notification: StoredNotification,
  userId: string,
  cache: Map<string, Promise<boolean>>,
) {
  const explicitlyPrivate =
    notification.boardVisibility === "private" ||
    notification.postVisibility === "private";
  if (!notification.boardId) return !explicitlyPrivate;
  const cacheKey = `${notification.boardId}:${explicitlyPrivate ? "private" : "public"}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const authorization = (async () => {
    const requiresPrivateAccess =
      explicitlyPrivate ||
      (await isForumBoardWithinPrivateTree(database, notification.boardId!));
    if (!requiresPrivateAccess) return true;
    const board = await loadForumBoard(database, notification.boardId!);
    return board ? canViewPrivateForumContent(database, board, userId) : false;
  })();
  cache.set(cacheKey, authorization);
  return authorization;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeNotificationCursor(cursorValue);
  if (cursorValue !== null && !cursor)
    throw new Response("Invalid cursor", { status: 400 });
  const unreadOnly =
    new URL(request.url).searchParams.get("filter") === "unread";
  const result = await listNotifications(
    context.cloudflare.env.DB,
    session.user.id,
    cursor,
    unreadOnly,
  );
  const accessCache = new Map<string, Promise<boolean>>();
  const notifications = await Promise.all(
    result.results.map(async (notification) => {
      const authorized = await authorizeNotification(
        context.cloudflare.env.DB,
        notification,
        session.user.id,
        accessCache,
      );
      return notificationForViewer(notification, authorized);
    }),
  );
  return {
    notifications,
    nextCursor: result.nextCursor ?? null,
    unreadOnly,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const form = await request.formData();
  if (String(form.get("intent") ?? "") === "mark-all-read") {
    await markAllNotificationsRead(context.cloudflare.env.DB, session.user.id);
    return redirect("/notifications");
  }
  await markNotificationRead(
    context.cloudflare.env.DB,
    String(form.get("notificationId") ?? ""),
    session.user.id,
  );
  return redirect("/notifications");
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">通知</h1>
        <div className="flex gap-3 text-sm">
          <Link
            className="text-blue-700 hover:underline"
            to="/notifications?filter=unread"
          >
            只看未读
          </Link>
          <Form method="post">
            <input type="hidden" name="intent" value="mark-all-read" />
            <button className="text-slate-600 hover:text-slate-950">
              全部标为已读
            </button>
          </Form>
        </div>
      </div>
      {loaderData.notifications.length > 0 ? (
        <ol className="mt-8 divide-y border-y">
          {loaderData.notifications.map((notification) => {
            const target =
              notification.preview.boardTitle && notification.threadId
                ? `/threads/${notification.threadId}${notification.postId ? `#post-${notification.postId}` : ""}`
                : null;
            return (
              <li key={notification.id} className="py-4">
                <p className="text-sm text-slate-700">
                  {notification.preview.author || "有人"}{" "}
                  {notificationLabel(notification.type)}
                  {notification.preview.boardTitle
                    ? ` · ${notification.preview.boardTitle}`
                    : ""}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {notification.createdAt.slice(0, 16).replace("T", " ")}
                </p>
                <div className="mt-3 flex gap-4 text-sm">
                  {target ? (
                    <Link className="text-blue-700 hover:underline" to={target}>
                      查看
                    </Link>
                  ) : null}
                  {!notification.readAt ? (
                    <Form method="post">
                      <input
                        type="hidden"
                        name="notificationId"
                        value={notification.id}
                      />
                      <button className="text-slate-600 hover:text-slate-950">
                        标为已读
                      </button>
                    </Form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-8 text-sm text-slate-500">暂无通知。</p>
      )}
      {loaderData.nextCursor ? (
        <Link
          className="mt-5 inline-block text-sm text-blue-700 hover:underline"
          to={`/notifications?${loaderData.unreadOnly ? "filter=unread&" : ""}cursor=${loaderData.nextCursor}`}
        >
          加载更多通知
        </Link>
      ) : null}
    </main>
  );
}
