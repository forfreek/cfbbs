import { notificationPreview } from "./privacy";
import {
  canViewPrivateForumContent,
  isForumBoardWithinPrivateTree,
} from "@/modules/forum/access.server";
import { loadForumBoard } from "@/modules/forum/read.server";
import {
  blockedInstanceDomainsForRemoteUris,
  remoteInstanceDomain,
} from "@/modules/moderation/instance-policy";

export type StoredNotification = {
  id: string;
  actorId: string;
  type: "reply" | "follow" | "like" | "mention" | "thread-reply";
  threadId: string | null;
  postId: string | null;
  readAt: string | null;
  createdAt: string;
  actorHandle: string | null;
  actorName: string | null;
  actorUri: string | null;
  actorIsLocal: number | null;
  boardId: string | null;
  boardTitle: string | null;
  boardVisibility: "public" | "private" | null;
  postVisibility: "public" | "private" | null;
};

export type NotificationCursor = { createdAt: string; id: string };

export function encodeNotificationCursor(cursor: NotificationCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeNotificationCursor(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (typeof cursor.createdAt !== "string" || typeof cursor.id !== "string")
      return null;
    return {
      createdAt: cursor.createdAt,
      id: cursor.id,
    } satisfies NotificationCursor;
  } catch {
    return null;
  }
}

export function notificationForViewer(
  notification: StoredNotification,
  authorized: boolean,
) {
  return {
    id: notification.id,
    type: notification.type,
    threadId: authorized ? notification.threadId : null,
    ...(authorized && notification.postId
      ? { postId: notification.postId }
      : {}),
    readAt: notification.readAt,
    createdAt: notification.createdAt,
    preview: notificationPreview({
      authorized,
      boardTitle: notification.boardTitle ?? "",
      author: notification.actorName ?? notification.actorHandle ?? "",
      excerpt: "",
    }),
  };
}

export async function listNotifications(
  database: D1Database,
  recipientUserId: string,
  cursor: NotificationCursor | null = null,
  unreadOnly = false,
) {
  const unreadClause = unreadOnly ? "AND notifications.read_at IS NULL" : "";
  const cursorClause = cursor
    ? "AND (notifications.created_at < ? OR (notifications.created_at = ? AND notifications.id < ?))"
    : "";
  const query = `SELECT notifications.id, notifications.actor_id AS actorId, notifications.type, notifications.thread_id AS threadId, notifications.post_id AS postId, notifications.read_at AS readAt, notifications.created_at AS createdAt, COALESCE(profiles.handle, federation_actors.handle) AS actorHandle, COALESCE(profiles.display_name, federation_actors.name) AS actorName, federation_actors.uri AS actorUri, federation_actors.is_local AS actorIsLocal, boards.id AS boardId, boards.title AS boardTitle, boards.visibility AS boardVisibility, posts.visibility AS postVisibility FROM notifications LEFT JOIN profiles ON profiles.user_id = notifications.actor_id LEFT JOIN federation_actors ON federation_actors.id = notifications.actor_id LEFT JOIN posts ON posts.id = notifications.post_id LEFT JOIN threads ON threads.id = notifications.thread_id LEFT JOIN boards ON boards.id = threads.board_id WHERE notifications.recipient_user_id = ? ${unreadClause} AND NOT EXISTS (SELECT 1 FROM user_actor_preferences WHERE user_actor_preferences.user_id = notifications.recipient_user_id AND user_actor_preferences.actor_id = notifications.actor_id) AND (federation_actors.id IS NULL OR federation_actors.is_local = 1 OR federation_actors.blocked_at IS NULL) ${cursorClause} ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT ${cursor ? "?" : "50"}`;
  const params = cursor
    ? [recipientUserId, cursor.createdAt, cursor.createdAt, cursor.id, 51]
    : [recipientUserId];
  const notifications = await database
    .prepare(query)
    .bind(...params)
    .all<StoredNotification>();
  const results = notifications.results.slice(0, 50);
  const blockedDomains = await blockedInstanceDomainsForRemoteUris(
    database,
    results
      .filter((notification) => !notification.actorIsLocal)
      .map((notification) => notification.actorUri),
  );
  return {
    ...notifications,
    results: results.filter((notification) => {
      if (notification.actorIsLocal || !notification.actorUri) return true;
      const domain = remoteInstanceDomain(notification.actorUri);
      return domain === null || !blockedDomains.has(domain);
    }),
    ...(notifications.results.length > 50 && results.at(-1)
      ? {
          nextCursor: encodeNotificationCursor({
            createdAt: results.at(-1)!.createdAt,
            id: results.at(-1)!.id,
          }),
        }
      : {}),
  };
}

export async function markNotificationRead(
  database: D1Database,
  notificationId: string,
  recipientUserId: string,
) {
  const result = await database
    .prepare(
      "UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL",
    )
    .bind(new Date().toISOString(), notificationId, recipientUserId)
    .run();
  return result.meta.changes > 0;
}

export async function markAllNotificationsRead(
  database: D1Database,
  recipientUserId: string,
) {
  const result = await database
    .prepare(
      "UPDATE notifications SET read_at = ? WHERE recipient_user_id = ? AND read_at IS NULL",
    )
    .bind(new Date().toISOString(), recipientUserId)
    .run();
  return result.meta.changes;
}

export async function countUnreadNotifications(
  database: D1Database,
  recipientUserId: string,
) {
  const result = await database
    .prepare(
      `SELECT notifications.id,
              boards.id AS boardId,
              boards.visibility AS boardVisibility,
              posts.visibility AS postVisibility
       FROM notifications
       LEFT JOIN federation_actors ON federation_actors.id = notifications.actor_id
       LEFT JOIN posts ON posts.id = notifications.post_id
       LEFT JOIN threads ON threads.id = notifications.thread_id
       LEFT JOIN boards ON boards.id = threads.board_id
       WHERE notifications.recipient_user_id = ?
         AND notifications.read_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM user_actor_preferences
           WHERE user_actor_preferences.user_id = notifications.recipient_user_id
             AND user_actor_preferences.actor_id = notifications.actor_id
         )
         AND (federation_actors.id IS NULL OR federation_actors.is_local = 1 OR federation_actors.blocked_at IS NULL)`,
    )
    .bind(recipientUserId)
    .all<{
      id: string;
      boardId: string | null;
      boardVisibility: "public" | "private" | null;
      postVisibility: "public" | "private" | null;
    }>();
  const boardAccess = new Map<string, Promise<boolean>>();
  let total = 0;
  for (const notification of result.results) {
    const explicitlyPrivate =
      notification.boardVisibility === "private" ||
      notification.postVisibility === "private";
    if (!notification.boardId && !explicitlyPrivate) {
      total += 1;
      continue;
    }
    if (!notification.boardId) continue;
    const cacheKey = `${notification.boardId}:${explicitlyPrivate ? "private" : "public"}`;
    let allowed = boardAccess.get(cacheKey);
    if (!allowed) {
      allowed = (async () => {
        const requiresPrivateAccess =
          explicitlyPrivate ||
          (await isForumBoardWithinPrivateTree(
            database,
            notification.boardId!,
          ));
        if (!requiresPrivateAccess) return true;
        const board = await loadForumBoard(database, notification.boardId!);
        return board
          ? canViewPrivateForumContent(database, board, recipientUserId)
          : false;
      })();
      boardAccess.set(cacheKey, allowed);
    }
    if (await allowed) total += 1;
  }
  return total;
}
