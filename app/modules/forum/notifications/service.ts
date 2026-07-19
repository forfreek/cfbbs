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
  const result = await database
    .prepare(
      "INSERT INTO notifications (id, recipient_user_id, actor_id, type, thread_id, post_id, read_at, created_at) SELECT ?, ?, ?, ?, ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM user_actor_preferences WHERE user_actor_preferences.user_id = ? AND user_actor_preferences.actor_id = ?)",
    )
    .bind(
      notification.id,
      notification.recipientUserId,
      notification.actorId,
      notification.type,
      notification.threadId ?? null,
      notification.postId ?? null,
      new Date().toISOString(),
      notification.recipientUserId,
      notification.actorId,
    )
    .run();
  return result.meta.changes === 1;
}
