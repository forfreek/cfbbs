export async function setThreadLocked(
  database: D1Database,
  input: {
    threadId: string;
    locked: boolean;
    actorUserId: string;
    auditId: string;
  },
) {
  if (
    !input.threadId.trim() ||
    !input.actorUserId.trim() ||
    !input.auditId.trim()
  ) {
    throw new Error("Thread, moderator, and audit identifiers are required.");
  }
  const now = new Date().toISOString();
  const results = await database.batch([
    database
      .prepare("UPDATE threads SET is_locked = ?, updated_at = ? WHERE id = ?")
      .bind(input.locked ? 1 : 0, now, input.threadId),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, 'thread', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.actorUserId,
        input.locked ? "thread.lock" : "thread.unlock",
        input.threadId,
        JSON.stringify({ locked: input.locked }),
        now,
      ),
  ]);
  return results[0]?.meta.changes === 1;
}

export async function setThreadPinned(
  database: D1Database,
  input: {
    threadId: string;
    pinned: boolean;
    actorUserId: string;
    auditId: string;
  },
) {
  if (
    !input.threadId.trim() ||
    !input.actorUserId.trim() ||
    !input.auditId.trim()
  ) {
    throw new Error("Thread, moderator, and audit identifiers are required.");
  }
  const now = new Date().toISOString();
  const results = await database.batch([
    database
      .prepare("UPDATE threads SET is_pinned = ?, updated_at = ? WHERE id = ?")
      .bind(input.pinned ? 1 : 0, now, input.threadId),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, 'thread', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.actorUserId,
        input.pinned ? "thread.pin" : "thread.unpin",
        input.threadId,
        JSON.stringify({ pinned: input.pinned }),
        now,
      ),
  ]);
  return results[0]?.meta.changes === 1;
}
