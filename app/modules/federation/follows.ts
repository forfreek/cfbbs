import { isSafeRemoteUrl } from "./remote-url";

type Statement = { sql: string; params: readonly unknown[] };

export type RemoteFollower = {
  uri: string;
  inboxUrl: string;
  sharedInboxUrl: string | null;
  publicKeyPem: string;
  name: string;
};

export type AcceptedRemoteFollow = {
  eventId: string;
  followActivityId: string;
  localActorId: string;
  localHandle: string;
  origin: string;
  follower: RemoteFollower;
};

function validateRemoteFollower(follower: RemoteFollower) {
  if (!isSafeRemoteUrl(follower.uri)) {
    throw new Error("Remote follower URI must be a public HTTPS URL.");
  }
  if (!isSafeRemoteUrl(follower.inboxUrl)) {
    throw new Error("Remote follower inbox must be a public HTTPS URL.");
  }
  if (
    follower.sharedInboxUrl !== null &&
    !isSafeRemoteUrl(follower.sharedInboxUrl)
  ) {
    throw new Error(
      "Remote follower shared inbox must be a public HTTPS URL when present.",
    );
  }
  if (!follower.publicKeyPem.trim()) {
    throw new Error("Remote follower must provide a public key.");
  }
}

export function createFollowAcceptActivity(input: AcceptedRemoteFollow) {
  const localActorUri = new URL(`/users/${input.localHandle}`, input.origin)
    .href;
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`/activities/accept/${input.eventId}`, input.origin).href,
    type: "Accept",
    actor: localActorUri,
    object: input.followActivityId,
  };
}

export function acceptedRemoteFollowStatements(
  input: AcceptedRemoteFollow,
  now: string,
): Statement[] {
  validateRemoteFollower(input.follower);
  if (!isSafeRemoteUrl(input.followActivityId)) {
    throw new Error("Follow activity ID must be a public HTTPS URL.");
  }
  if (!input.eventId || !input.localActorId || !input.localHandle) {
    throw new Error("Follow acceptance identifiers are required.");
  }

  const targetInboxUrl =
    input.follower.sharedInboxUrl ?? input.follower.inboxUrl;
  const activity = createFollowAcceptActivity(input);
  return [
    {
      sql: "INSERT INTO federation_actors (id, uri, handle, inbox_url, shared_inbox_url, outbox_url, followers_url, public_key_pem, name, summary_html, avatar_url, is_local, blocked_at, last_fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, '', NULL, 0, NULL, ?, ?, ?) ON CONFLICT(uri) DO UPDATE SET inbox_url = excluded.inbox_url, shared_inbox_url = excluded.shared_inbox_url, public_key_pem = excluded.public_key_pem, name = excluded.name, last_fetched_at = excluded.last_fetched_at, updated_at = excluded.updated_at",
      params: [
        input.follower.uri,
        input.follower.uri,
        `remote:${input.follower.uri}`,
        input.follower.inboxUrl,
        input.follower.sharedInboxUrl,
        input.follower.publicKeyPem,
        input.follower.name.trim() || input.follower.uri,
        now,
        now,
        now,
      ],
    },
    {
      sql: "INSERT INTO federation_follows (id, follower_actor_id, following_actor_id, follow_activity_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'accepted', ?, ?) ON CONFLICT(follower_actor_id, following_actor_id) DO UPDATE SET follow_activity_id = excluded.follow_activity_id, state = 'accepted', updated_at = excluded.updated_at",
      params: [
        crypto.randomUUID(),
        input.follower.uri,
        input.localActorId,
        input.followActivityId,
        now,
        now,
      ],
    },
    {
      sql: "INSERT OR IGNORE INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'follow', ?, 'Accept', ?, 'direct', 'pending', NULL, ?, ?)",
      params: [
        input.eventId,
        input.localActorId,
        input.followActivityId,
        JSON.stringify(activity),
        now,
        now,
      ],
    },
    {
      sql: "INSERT OR IGNORE INTO federation_deliveries (id, outbox_event_id, target_inbox_url, state, attempts, next_attempt_at, last_error, delivered_at, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)",
      params: [
        crypto.randomUUID(),
        input.eventId,
        targetInboxUrl,
        now,
        now,
        now,
      ],
    },
  ];
}

export async function acceptRemoteFollow(
  database: D1Database,
  input: AcceptedRemoteFollow,
) {
  const now = new Date().toISOString();
  await database.batch(
    acceptedRemoteFollowStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
}
