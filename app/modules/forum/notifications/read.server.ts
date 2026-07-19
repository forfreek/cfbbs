import { notificationPreview } from "./privacy";
import {
  blockedInstanceDomainsForRemoteUris,
  remoteInstanceDomain,
} from "@/modules/moderation/instance-policy";

export type StoredNotification = {
  id: string;
  actorId: string;
  type: "reply" | "follow" | "like";
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

export function notificationForViewer(
  notification: StoredNotification,
  authorized: boolean,
) {
  return {
    id: notification.id,
    type: notification.type,
    threadId: authorized ? notification.threadId : null,
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
) {
  const notifications = await database
    .prepare(
      "SELECT notifications.id, notifications.actor_id AS actorId, notifications.type, notifications.thread_id AS threadId, notifications.post_id AS postId, notifications.read_at AS readAt, notifications.created_at AS createdAt, COALESCE(profiles.handle, federation_actors.handle) AS actorHandle, COALESCE(profiles.display_name, federation_actors.name) AS actorName, federation_actors.uri AS actorUri, federation_actors.is_local AS actorIsLocal, boards.id AS boardId, boards.title AS boardTitle, boards.visibility AS boardVisibility, posts.visibility AS postVisibility FROM notifications LEFT JOIN profiles ON profiles.user_id = notifications.actor_id LEFT JOIN federation_actors ON federation_actors.id = notifications.actor_id LEFT JOIN posts ON posts.id = notifications.post_id LEFT JOIN threads ON threads.id = notifications.thread_id LEFT JOIN boards ON boards.id = threads.board_id WHERE notifications.recipient_user_id = ? AND NOT EXISTS (SELECT 1 FROM user_actor_preferences WHERE user_actor_preferences.user_id = notifications.recipient_user_id AND user_actor_preferences.actor_id = notifications.actor_id) AND (federation_actors.id IS NULL OR federation_actors.is_local = 1 OR federation_actors.blocked_at IS NULL) ORDER BY notifications.created_at DESC, notifications.id DESC LIMIT 50",
    )
    .bind(recipientUserId)
    .all<StoredNotification>();
  const blockedDomains = await blockedInstanceDomainsForRemoteUris(
    database,
    notifications.results
      .filter((notification) => !notification.actorIsLocal)
      .map((notification) => notification.actorUri),
  );
  return {
    ...notifications,
    results: notifications.results.filter((notification) => {
      if (notification.actorIsLocal || !notification.actorUri) return true;
      const domain = remoteInstanceDomain(notification.actorUri);
      return domain === null || !blockedDomains.has(domain);
    }),
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
