export type AuditLogEntry = {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: string;
  createdAt: string;
};

export async function listAuditLogs(database: D1Database) {
  return database
    .prepare(
      "SELECT id, actor_user_id AS actorUserId, action, target_type AS targetType, target_id AS targetId, metadata, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 100",
    )
    .all<AuditLogEntry>();
}
