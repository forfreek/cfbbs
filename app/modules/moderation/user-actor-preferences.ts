export type UserActorPreferenceState = "muted" | "blocked";

export type UserActorPreference = {
  userId: string;
  actorId: string;
  state: UserActorPreferenceState;
  createdAt: string;
  updatedAt: string;
  actorUri: string;
  actorName: string;
};

type ExistingPreference = { state: UserActorPreferenceState };

async function remoteActorExists(database: D1Database, actorId: string) {
  return database
    .prepare(
      "SELECT id FROM federation_actors WHERE id = ? AND is_local = 0 LIMIT 1",
    )
    .bind(actorId)
    .first<{ id: string }>();
}

function validateInput(input: {
  userId: string;
  actorId: string;
  auditId: string;
}) {
  if (!input.userId.trim() || !input.actorId.trim() || !input.auditId.trim()) {
    throw new Error("User, remote actor, and audit identifiers are required.");
  }
}

export async function setUserActorPreference(
  database: D1Database,
  input: {
    userId: string;
    actorId: string;
    state: UserActorPreferenceState;
    auditId: string;
  },
) {
  validateInput(input);
  const [actor, existing] = await Promise.all([
    remoteActorExists(database, input.actorId),
    database
      .prepare(
        "SELECT state FROM user_actor_preferences WHERE user_id = ? AND actor_id = ? LIMIT 1",
      )
      .bind(input.userId, input.actorId)
      .first<ExistingPreference>(),
  ]);
  if (!actor) throw new Error("Remote actor does not exist.");
  if (existing?.state === input.state) return false;

  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO user_actor_preferences (user_id, actor_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, actor_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
      )
      .bind(input.userId, input.actorId, input.state, now, now),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, 'federation_actor', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.userId,
        `user_actor_preference.${input.state}`,
        input.actorId,
        JSON.stringify({ previousState: existing?.state ?? null }),
        now,
      ),
  ]);
  return true;
}

export async function clearUserActorPreference(
  database: D1Database,
  input: { userId: string; actorId: string; auditId: string },
) {
  validateInput(input);
  const existing = await database
    .prepare(
      "SELECT state FROM user_actor_preferences WHERE user_id = ? AND actor_id = ? LIMIT 1",
    )
    .bind(input.userId, input.actorId)
    .first<ExistingPreference>();
  if (!existing) return false;

  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "DELETE FROM user_actor_preferences WHERE user_id = ? AND actor_id = ?",
      )
      .bind(input.userId, input.actorId),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'user_actor_preference.clear', 'federation_actor', ?, ?, ?)",
      )
      .bind(
        input.auditId,
        input.userId,
        input.actorId,
        JSON.stringify({ previousState: existing.state }),
        now,
      ),
  ]);
  return true;
}

export async function listUserActorPreferences(
  database: D1Database,
  userId: string,
) {
  return database
    .prepare(
      "SELECT user_actor_preferences.user_id AS userId, user_actor_preferences.actor_id AS actorId, user_actor_preferences.state, user_actor_preferences.created_at AS createdAt, user_actor_preferences.updated_at AS updatedAt, federation_actors.uri AS actorUri, federation_actors.name AS actorName FROM user_actor_preferences INNER JOIN federation_actors ON federation_actors.id = user_actor_preferences.actor_id WHERE user_actor_preferences.user_id = ? ORDER BY user_actor_preferences.updated_at DESC, federation_actors.uri ASC",
    )
    .bind(userId)
    .all<UserActorPreference>();
}
