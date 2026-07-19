type Statement = { sql: string; params: readonly unknown[] };

export type RemoteLike = {
  activityId: string;
  actorUri: string;
  postId: string;
  threadId: string;
  recipientUserId: string;
};

export function remoteLikeStatements(
  input: RemoteLike,
  now: string,
): Statement[] {
  return [
    {
      sql: "INSERT OR IGNORE INTO post_likes (post_id, actor_id, activity_id, created_at) VALUES (?, ?, ?, ?)",
      params: [input.postId, input.actorUri, input.activityId, now],
    },
    {
      sql: "INSERT INTO notifications (id, recipient_user_id, actor_id, type, thread_id, post_id, read_at, created_at) SELECT ?, ?, ?, 'like', ?, ?, NULL, ? WHERE ? != ? AND EXISTS (SELECT 1 FROM post_likes WHERE post_id = ? AND actor_id = ? AND activity_id = ?) AND NOT EXISTS (SELECT 1 FROM notifications WHERE recipient_user_id = ? AND actor_id = ? AND type = 'like' AND post_id = ?)",
      params: [
        crypto.randomUUID(),
        input.recipientUserId,
        input.actorUri,
        input.threadId,
        input.postId,
        now,
        input.recipientUserId,
        input.actorUri,
        input.postId,
        input.actorUri,
        input.activityId,
        input.recipientUserId,
        input.actorUri,
        input.postId,
      ],
    },
  ];
}

export async function recordRemoteLike(
  database: D1Database,
  input: RemoteLike,
) {
  const now = new Date().toISOString();
  const results = await database.batch(
    remoteLikeStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
  return results[0]?.meta.changes === 1;
}

export async function undoRemoteLike(
  database: D1Database,
  input: { activityId: string; actorUri: string },
) {
  const result = await database
    .prepare("DELETE FROM post_likes WHERE activity_id = ? AND actor_id = ?")
    .bind(input.activityId, input.actorUri)
    .run();
  return result.meta.changes === 1;
}
