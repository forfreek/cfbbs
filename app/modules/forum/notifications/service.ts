export type NewNotification = {
  id: string;
  recipientUserId: string;
  actorId: string;
  type: "reply" | "follow" | "like" | "mention" | "thread-reply";
  threadId?: string | null;
  postId?: string | null;
};

export async function createNotification(
  database: D1Database,
  notification: NewNotification,
) {
  if (notification.recipientUserId === notification.actorId) return false;
  const createdAt = new Date().toISOString();
  const batch = (
    database as unknown as {
      batch?: (
        statements: unknown[],
      ) => Promise<Array<{ meta?: { changes?: number } }>>;
    }
  ).batch;
  if (!batch) {
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
        createdAt,
        notification.recipientUserId,
        notification.actorId,
      )
      .run();
    return result.meta.changes === 1;
  }
  const result = await database.batch([
    database
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
        createdAt,
        notification.recipientUserId,
        notification.actorId,
      ),
    database
      .prepare(
        "INSERT OR IGNORE INTO notification_push_outbox (id, notification_id, state, attempts, next_attempt_at, last_error, created_at, sent_at) SELECT ?, ?, 'pending', 0, ?, NULL, ?, NULL WHERE EXISTS (SELECT 1 FROM notifications WHERE id = ?)",
      )
      .bind(
        crypto.randomUUID(),
        notification.id,
        createdAt,
        createdAt,
        notification.id,
      ),
  ]);
  return result[0]?.meta.changes === 1;
}
