import { actorId } from "./identifiers";
import { generateFederationSigningKeyPair } from "./keys";
import { validateHandle } from "@/modules/identity/handle";

export type NewLocalActor = {
  userId: string;
  handle: string;
  displayName: string;
  origin: string;
  encryptionSecret: string;
};

type LocalActorKeyPair = {
  publicKeyPem: string;
  privateKeyEncrypted: string;
};

type Statement = { sql: string; params: readonly unknown[] };

export function localActorInsertStatements(
  input: Omit<NewLocalActor, "encryptionSecret">,
  keys: LocalActorKeyPair,
  now: string,
): Statement[] {
  const handle = validateHandle(input.handle);
  if (!handle.ok) throw new Error("A valid federation handle is required.");

  const uri = actorId(input.origin, handle.value);
  const federationHandle = `@${handle.value}@${new URL(input.origin).host}`;
  return [
    {
      sql: "INSERT INTO profiles (user_id, handle, display_name, bio, avatar_url, federation_private_key_encrypted, created_at, updated_at) VALUES (?, ?, ?, '', NULL, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET federation_private_key_encrypted = excluded.federation_private_key_encrypted, updated_at = excluded.updated_at",
      params: [
        input.userId,
        handle.value,
        input.displayName,
        keys.privateKeyEncrypted,
        now,
        now,
      ],
    },
    {
      sql: "INSERT INTO federation_actors (id, uri, handle, inbox_url, shared_inbox_url, outbox_url, followers_url, public_key_pem, name, summary_html, avatar_url, is_local, blocked_at, last_fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, '', NULL, 1, NULL, ?, ?, ?)",
      params: [
        input.userId,
        uri,
        federationHandle,
        new URL(`/users/${handle.value}/inbox`, input.origin).href,
        new URL(`/users/${handle.value}/outbox`, input.origin).href,
        new URL(`/users/${handle.value}/followers`, input.origin).href,
        keys.publicKeyPem,
        input.displayName,
        now,
        now,
        now,
      ],
    },
  ];
}

export async function createLocalActor(
  database: D1Database,
  input: NewLocalActor,
) {
  if (!input.encryptionSecret.trim()) {
    throw new Error("FEDERATION_KEY_ENCRYPTION_SECRET must be configured.");
  }

  const existing = await database
    .prepare(
      "SELECT id FROM federation_actors WHERE id = ? AND is_local = 1 LIMIT 1",
    )
    .bind(input.userId)
    .first<{ id: string }>();
  if (existing) return false;

  const now = new Date().toISOString();
  const keys = await generateFederationSigningKeyPair(input.encryptionSecret);
  const statements = localActorInsertStatements(input, keys, now).map(
    (statement) => database.prepare(statement.sql).bind(...statement.params),
  );
  await database.batch(statements);
  return true;
}
