import { isSafeRemoteUrl } from "./remote-url";

type Statement = { sql: string; params: readonly unknown[] };

export type RemoteActor = {
  uri: string;
  inboxUrl: string;
  sharedInboxUrl: string | null;
  publicKeyPem: string;
  name: string;
};

export type RemoteFollower = RemoteActor;

export type AcceptedRemoteFollow = {
  eventId: string;
  followActivityId: string;
  localActorId: string;
  localHandle: string;
  origin: string;
  follower: RemoteFollower;
};

export type OutboundFollow = {
  eventId: string;
  localActorId: string;
  localHandle: string;
  origin: string;
  following: RemoteActor;
};

export type OutboundFollowUndo = OutboundFollow & {
  followActivityId: string;
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

function remoteActorUpsertStatement(
  actor: RemoteActor,
  now: string,
): Statement {
  return {
    sql: "INSERT INTO federation_actors (id, uri, handle, inbox_url, shared_inbox_url, outbox_url, followers_url, public_key_pem, name, summary_html, avatar_url, is_local, blocked_at, last_fetched_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, '', NULL, 0, NULL, ?, ?, ?) ON CONFLICT(uri) DO UPDATE SET inbox_url = excluded.inbox_url, shared_inbox_url = excluded.shared_inbox_url, public_key_pem = excluded.public_key_pem, name = excluded.name, last_fetched_at = excluded.last_fetched_at, updated_at = excluded.updated_at",
    params: [
      actor.uri,
      actor.uri,
      `remote:${actor.uri}`,
      actor.inboxUrl,
      actor.sharedInboxUrl,
      actor.publicKeyPem,
      actor.name.trim() || actor.uri,
      now,
      now,
      now,
    ],
  };
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
    to: input.follower.uri,
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
    remoteActorUpsertStatement(input.follower, now),
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

export function createOutboundFollowActivity(input: OutboundFollow) {
  const actor = new URL(`/users/${input.localHandle}`, input.origin).href;
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`/activities/follow/${input.eventId}`, input.origin).href,
    type: "Follow",
    actor,
    object: input.following.uri,
    to: input.following.uri,
  };
}

export function createOutboundFollowUndoActivity(input: OutboundFollowUndo) {
  const actor = new URL(`/users/${input.localHandle}`, input.origin).href;
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`/activities/undo/${input.eventId}`, input.origin).href,
    type: "Undo",
    actor,
    object: input.followActivityId,
    to: input.following.uri,
  };
}

export function outboundFollowStatements(
  input: OutboundFollow,
  now: string,
): Statement[] {
  validateRemoteFollower(input.following);
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.eventId) ||
    !input.localActorId ||
    !input.localHandle
  ) {
    throw new Error("Outbound Follow identifiers are required.");
  }

  const activity = createOutboundFollowActivity(input);
  const targetInboxUrl =
    input.following.sharedInboxUrl ?? input.following.inboxUrl;
  return [
    remoteActorUpsertStatement(input.following, now),
    {
      sql: "INSERT INTO federation_follows (id, follower_actor_id, following_actor_id, follow_activity_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT(follower_actor_id, following_actor_id) DO UPDATE SET follow_activity_id = excluded.follow_activity_id, state = 'pending', updated_at = excluded.updated_at",
      params: [
        crypto.randomUUID(),
        input.localActorId,
        input.following.uri,
        activity.id,
        now,
        now,
      ],
    },
    {
      sql: "INSERT OR IGNORE INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'follow', ?, 'Follow', ?, 'direct', 'pending', NULL, ?, ?)",
      params: [
        input.eventId,
        input.localActorId,
        activity.id,
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

export function outboundFollowUndoStatements(
  input: OutboundFollowUndo,
  now: string,
): Statement[] {
  validateRemoteFollower(input.following);
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.eventId) ||
    !input.localActorId ||
    !input.localHandle
  ) {
    throw new Error("Outbound Follow identifiers are required.");
  }
  let followActivityOrigin: string;
  try {
    followActivityOrigin = new URL(input.followActivityId).origin;
  } catch {
    throw new Error("Outbound Follow activity ID must be a URL.");
  }
  if (followActivityOrigin !== new URL(input.origin).origin) {
    throw new Error(
      "Outbound Follow activity ID must belong to this instance.",
    );
  }

  const activity = createOutboundFollowUndoActivity(input);
  const targetInboxUrl =
    input.following.sharedInboxUrl ?? input.following.inboxUrl;
  const activeFollow =
    "follower_actor_id = ? AND following_actor_id = ? AND follow_activity_id = ? AND state IN ('pending', 'accepted')";
  return [
    {
      sql: `INSERT OR IGNORE INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) SELECT ?, ?, 'follow', ?, 'Undo', ?, 'direct', 'pending', NULL, ?, ? WHERE EXISTS (SELECT 1 FROM federation_follows WHERE ${activeFollow})`,
      params: [
        input.eventId,
        input.localActorId,
        input.followActivityId,
        JSON.stringify(activity),
        now,
        now,
        input.localActorId,
        input.following.uri,
        input.followActivityId,
      ],
    },
    {
      sql: "INSERT OR IGNORE INTO federation_deliveries (id, outbox_event_id, target_inbox_url, state, attempts, next_attempt_at, last_error, delivered_at, created_at, updated_at) SELECT ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM federation_outbox_events WHERE id = ?)",
      params: [
        crypto.randomUUID(),
        input.eventId,
        targetInboxUrl,
        now,
        now,
        now,
        input.eventId,
      ],
    },
    {
      sql: `UPDATE federation_follows SET state = 'undone', updated_at = ? WHERE ${activeFollow}`,
      params: [
        now,
        input.localActorId,
        input.following.uri,
        input.followActivityId,
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

export async function createOutboundFollow(
  database: D1Database,
  input: OutboundFollow,
) {
  const now = new Date().toISOString();
  await database.batch(
    outboundFollowStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
}

export async function undoOutboundFollow(
  database: D1Database,
  input: OutboundFollowUndo,
) {
  const now = new Date().toISOString();
  const results = await database.batch(
    outboundFollowUndoStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
  return results.at(-1)?.meta.changes === 1;
}

export async function undoRemoteFollow(
  database: D1Database,
  input: {
    followActivityId: string;
    followerActorUri: string;
    localActorId: string;
  },
) {
  const result = await database
    .prepare(
      "UPDATE federation_follows SET state = 'undone', updated_at = ? WHERE follow_activity_id = ? AND follower_actor_id = ? AND following_actor_id = ? AND state = 'accepted'",
    )
    .bind(
      new Date().toISOString(),
      input.followActivityId,
      input.followerActorUri,
      input.localActorId,
    )
    .run();
  return result.meta.changes === 1;
}

export async function settleOutboundFollow(
  database: D1Database,
  input: {
    followActivityId: string;
    localActorId: string;
    remoteActorUri: string;
    state: "accepted" | "rejected";
  },
) {
  const result = await database
    .prepare(
      "UPDATE federation_follows SET state = ?, updated_at = ? WHERE follow_activity_id = ? AND follower_actor_id = ? AND following_actor_id = ? AND state = 'pending'",
    )
    .bind(
      input.state,
      new Date().toISOString(),
      input.followActivityId,
      input.localActorId,
      input.remoteActorUri,
    )
    .run();
  return result.meta.changes === 1;
}
