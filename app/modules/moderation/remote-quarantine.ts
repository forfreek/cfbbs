import { isSafeRemoteUrl } from "@/modules/federation/remote-url";

export const remoteActivityRateLimit = 30;
export const remoteActivityRateWindowMs = 60_000;
export const remoteRejectionLimit = 5;
export const remoteRejectionWindowMs = 24 * 60 * 60 * 1_000;
export const remoteQuarantineDurationMs = 24 * 60 * 60 * 1_000;

type CountRow = { count: number };
type QuarantineRow = { expiresAt: string };

export type RemoteActorQuarantine = {
  actorUri: string;
  reason: string;
  quarantinedAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export function quarantineReason(input: {
  activityCount: number;
  rejectedCount: number;
}) {
  if (input.activityCount > remoteActivityRateLimit) {
    return `Exceeded ${remoteActivityRateLimit} inbound activities per minute.`;
  }
  if (input.rejectedCount >= remoteRejectionLimit) {
    return `Reached ${remoteRejectionLimit} rejected activities within 24 hours.`;
  }
  return null;
}

export async function createRemoteActorQuarantine(
  database: D1Database,
  input: { actorUri: string; reason: string },
  now = new Date(),
) {
  if (!isSafeRemoteUrl(input.actorUri)) {
    throw new Error(
      "Remote actor quarantine requires a public HTTPS actor URI.",
    );
  }
  const timestamp = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + remoteQuarantineDurationMs,
  ).toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO federation_actor_quarantines (actor_uri, reason, quarantined_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(actor_uri) DO UPDATE SET reason = excluded.reason, quarantined_at = excluded.quarantined_at, expires_at = excluded.expires_at, updated_at = excluded.updated_at",
      )
      .bind(
        input.actorUri,
        input.reason,
        timestamp,
        expiresAt,
        timestamp,
        timestamp,
      ),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, NULL, 'federation_actor.quarantine', 'federation_actor', ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        input.actorUri,
        JSON.stringify({ reason: input.reason, expiresAt }),
        timestamp,
      ),
  ]);
  return { expiresAt, reason: input.reason };
}

export async function isRemoteActorQuarantined(
  database: D1Database,
  actorUri: string,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  const existing = await database
    .prepare(
      "SELECT expires_at AS expiresAt FROM federation_actor_quarantines WHERE actor_uri = ? AND expires_at > ? LIMIT 1",
    )
    .bind(actorUri, timestamp)
    .first<QuarantineRow>();
  if (existing) return true;

  const [rate, failures] = await Promise.all([
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM federation_inbox_receipts WHERE actor_uri = ? AND received_at >= ?",
      )
      .bind(
        actorUri,
        new Date(now.getTime() - remoteActivityRateWindowMs).toISOString(),
      )
      .first<CountRow>(),
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM federation_inbox_receipts WHERE actor_uri = ? AND state = 'rejected' AND processed_at >= ?",
      )
      .bind(
        actorUri,
        new Date(now.getTime() - remoteRejectionWindowMs).toISOString(),
      )
      .first<CountRow>(),
  ]);
  const reason = quarantineReason({
    activityCount: rate?.count ?? 0,
    rejectedCount: failures?.count ?? 0,
  });
  if (!reason) return false;
  await createRemoteActorQuarantine(database, { actorUri, reason }, now);
  return true;
}

export async function clearRemoteActorQuarantine(
  database: D1Database,
  input: { actorUri: string; moderatorUserId: string; auditId: string },
) {
  if (
    !input.actorUri.trim() ||
    !input.moderatorUserId.trim() ||
    !input.auditId.trim()
  ) {
    throw new Error("Actor, moderator, and audit identifiers are required.");
  }
  const existing = await database
    .prepare(
      "SELECT actor_uri AS actorUri FROM federation_actor_quarantines WHERE actor_uri = ? LIMIT 1",
    )
    .bind(input.actorUri)
    .first<{ actorUri: string }>();
  if (!existing) return false;
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("DELETE FROM federation_actor_quarantines WHERE actor_uri = ?")
      .bind(input.actorUri),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'federation_actor.quarantine_clear', 'federation_actor', ?, '{}', ?)",
      )
      .bind(input.auditId, input.moderatorUserId, input.actorUri, now),
  ]);
  return true;
}

export async function listRemoteActorQuarantines(database: D1Database) {
  return database
    .prepare(
      "SELECT actor_uri AS actorUri, reason, quarantined_at AS quarantinedAt, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt FROM federation_actor_quarantines WHERE expires_at > ? ORDER BY expires_at ASC, actor_uri ASC LIMIT 100",
    )
    .bind(new Date().toISOString())
    .all<RemoteActorQuarantine>();
}

export async function purgeExpiredRemoteActorQuarantines(
  database: D1Database,
  now = new Date(),
) {
  const result = await database
    .prepare("DELETE FROM federation_actor_quarantines WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();
  return result.meta.changes;
}
