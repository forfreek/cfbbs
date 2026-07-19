export async function createReport(
  database: D1Database,
  input: {
    id: string;
    reporterUserId: string | null;
    reporterActorId: string | null;
    postId: string | null;
    reason: string;
  },
) {
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO reports (id, reporter_user_id, reporter_actor_id, post_id, reason, state, resolved_by_user_id, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?, NULL)",
      )
      .bind(
        input.id,
        input.reporterUserId,
        input.reporterActorId,
        input.postId,
        input.reason.trim(),
        now,
      ),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'report.create', 'report', ?, '{}', ?)",
      )
      .bind(`${input.id}:audit`, input.reporterUserId, input.id, now),
  ]);
}
