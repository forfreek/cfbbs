export type NewNotification = {
  id: string;
  recipientUserId: string;
  actorId: string;
  type: "reply" | "follow" | "like";
  threadId?: string | null;
  postId?: string | null;
};

export async function createNotification(
  database: D1Database,
  notification: NewNotification,
) {
  if (notification.recipientUserId === notification.actorId) return false;
  await database
    .prepare(
      "INSERT INTO notifications (id, recipient_user_id, actor_id, type, thread_id, post_id, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    )
    .bind(
      notification.id,
      notification.recipientUserId,
      notification.actorId,
      notification.type,
      notification.threadId ?? null,
      notification.postId ?? null,
      new Date().toISOString(),
    )
    .run();
  return true;
}
