export type ModeratableRemoteActor = {
  id: string;
  uri: string;
  handle: string;
  name: string;
  blockedAt: string | null;
  updatedAt: string;
};

type RemoteActor = Pick<ModeratableRemoteActor, "id" | "uri" | "blockedAt">;

async function loadRemoteActor(database: D1Database, actorId: string) {
  return database
    .prepare(
      "SELECT id, uri, blocked_at AS blockedAt FROM federation_actors WHERE id = ? AND is_local = 0 LIMIT 1",
    )
    .bind(actorId)
    .first<RemoteActor>();
}

function validateInput(input: { actorId: string; moderatorUserId: string }) {
  if (!input.actorId.trim() || !input.moderatorUserId.trim()) {
    throw new Error("Remote actor and moderator identifiers are required.");
  }
}

export async function blockRemoteActor(
  database: D1Database,
  input: { actorId: string; moderatorUserId: string; auditId: string },
) {
  validateInput(input);
  const actor = await loadRemoteActor(database, input.actorId);
  if (!actor) throw new Error("Remote actor does not exist.");
  if (actor.blockedAt) return false;

  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE federation_actors SET blocked_at = ?, updated_at = ? WHERE id = ? AND is_local = 0 AND blocked_at IS NULL",
      )
      .bind(now, now, actor.id),
    database
      .prepare(
        "UPDATE posts SET state = 'hidden', updated_at = ? WHERE author_actor_id = ? AND origin = 'remote' AND state = 'published'",
      )
      .bind(now, actor.id),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'federation_actor.block', 'federation_actor', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.moderatorUserId,
        actor.id,
        JSON.stringify({ uri: actor.uri }),
        now,
      ),
  ]);
  return true;
}

export async function unblockRemoteActor(
  database: D1Database,
  input: { actorId: string; moderatorUserId: string; auditId: string },
) {
  validateInput(input);
  const actor = await loadRemoteActor(database, input.actorId);
  if (!actor) throw new Error("Remote actor does not exist.");
  if (!actor.blockedAt) return false;

  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE federation_actors SET blocked_at = NULL, updated_at = ? WHERE id = ? AND is_local = 0 AND blocked_at IS NOT NULL",
      )
      .bind(now, actor.id),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'federation_actor.unblock', 'federation_actor', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.moderatorUserId,
        actor.id,
        JSON.stringify({ uri: actor.uri }),
        now,
      ),
  ]);
  return true;
}

export async function listModeratableRemoteActors(database: D1Database) {
  return database
    .prepare(
      "SELECT id, uri, handle, name, blocked_at AS blockedAt, updated_at AS updatedAt FROM federation_actors WHERE is_local = 0 ORDER BY blocked_at IS NULL ASC, updated_at DESC, uri ASC LIMIT 200",
    )
    .all<ModeratableRemoteActor>();
}
