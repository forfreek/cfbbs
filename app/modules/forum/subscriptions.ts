export type ThreadSubscriptionMode = "all" | "mentions";

export type ThreadSubscription = {
  userId: string;
  threadId: string;
  mode: ThreadSubscriptionMode;
  createdAt: string;
  updatedAt: string;
};

export async function loadThreadSubscription(
  database: D1Database,
  userId: string,
  threadId: string,
) {
  return database
    .prepare(
      "SELECT user_id AS userId, thread_id AS threadId, mode, created_at AS createdAt, updated_at AS updatedAt FROM thread_subscriptions WHERE user_id = ? AND thread_id = ? LIMIT 1",
    )
    .bind(userId, threadId)
    .first<ThreadSubscription>();
}

export async function setThreadSubscription(
  database: D1Database,
  input: {
    userId: string;
    threadId: string;
    mode: ThreadSubscriptionMode | null;
  },
) {
  const thread = await database
    .prepare("SELECT id FROM threads WHERE id = ? LIMIT 1")
    .bind(input.threadId)
    .first<{ id: string }>();
  if (!thread) return { ok: false as const, message: "主题不存在。" };
  if (input.mode === null) {
    await database
      .prepare(
        "DELETE FROM thread_subscriptions WHERE user_id = ? AND thread_id = ?",
      )
      .bind(input.userId, input.threadId)
      .run();
    return { ok: true as const, subscribed: false };
  }
  const now = new Date().toISOString();
  await database
    .prepare(
      "INSERT INTO thread_subscriptions (user_id, thread_id, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, thread_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at",
    )
    .bind(input.userId, input.threadId, input.mode, now, now)
    .run();
  return { ok: true as const, subscribed: true, mode: input.mode };
}

export async function listThreadSubscriptions(
  database: D1Database,
  userId: string,
) {
  return database
    .prepare(
      `SELECT thread_subscriptions.thread_id AS threadId, thread_subscriptions.mode,
              thread_subscriptions.created_at AS createdAt, thread_subscriptions.updated_at AS updatedAt,
              threads.title AS threadTitle, boards.title AS boardTitle
       FROM thread_subscriptions
       INNER JOIN threads ON threads.id = thread_subscriptions.thread_id
       INNER JOIN boards ON boards.id = threads.board_id
       INNER JOIN posts AS first_post ON first_post.id = threads.first_post_id
       WHERE thread_subscriptions.user_id = ? AND first_post.state = 'published'
       ORDER BY thread_subscriptions.updated_at DESC, thread_subscriptions.thread_id DESC
       LIMIT 100`,
    )
    .bind(userId)
    .all<ThreadSubscription & { threadTitle: string; boardTitle: string }>();
}

export async function listThreadSubscriptionRecipients(
  database: D1Database,
  threadId: string,
) {
  const statement = database
    .prepare(
      "SELECT user_id AS userId, mode FROM thread_subscriptions WHERE thread_id = ?",
    )
    .bind(threadId) as unknown as {
    all?: <T>() => Promise<{ results: T[] }>;
  };
  if (!statement.all)
    return {
      results: [] as { userId: string; mode: ThreadSubscriptionMode }[],
    };
  return statement.all<{ userId: string; mode: ThreadSubscriptionMode }>();
}
