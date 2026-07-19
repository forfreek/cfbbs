import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/notifications";
import { canViewPrivateForumContent } from "@/modules/forum/access.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import {
  listNotifications,
  markNotificationRead,
  notificationForViewer,
  type StoredNotification,
} from "@/modules/forum/notifications/read.server";
import { getSession } from "@/modules/identity/auth.server";

function notificationLabel(type: StoredNotification["type"]) {
  if (type === "reply") return "回复了你的主题";
  if (type === "like") return "赞了你的帖子";
  return "关注了你";
}

async function authorizeNotification(
  database: D1Database,
  notification: StoredNotification,
  userId: string,
  cache: Map<string, Promise<boolean>>,
) {
  const requiresPrivateAccess =
    notification.boardVisibility === "private" ||
    notification.postVisibility === "private";
  if (!requiresPrivateAccess) return true;
  if (!notification.boardId) return false;
  const cached = cache.get(notification.boardId);
  if (cached) return cached;
  const authorization = (async () => {
    const board = await loadForumBoard(database, notification.boardId!);
    return board ? canViewPrivateForumContent(database, board, userId) : false;
  })();
  cache.set(notification.boardId, authorization);
  return authorization;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const result = await listNotifications(
    context.cloudflare.env.DB,
    session.user.id,
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
  return { notifications };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await getSession(request, context.cloudflare.env);
  if (!session) throw redirect("/auth/login");
  const form = await request.formData();
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
      <h1 className="text-3xl font-semibold tracking-tight">通知</h1>
      {loaderData.notifications.length > 0 ? (
        <ol className="mt-8 divide-y border-y">
          {loaderData.notifications.map((notification) => {
            const target =
              notification.preview.boardTitle && notification.threadId
                ? `/threads/${notification.threadId}`
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
    </main>
  );
}
