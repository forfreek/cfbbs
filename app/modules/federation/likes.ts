import { isSafeRemoteUrl } from "./remote-url";

type Statement = { sql: string; params: readonly unknown[] };

export type RemoteLike = {
  activityId: string;
  actorUri: string;
  postId: string;
  threadId: string;
  recipientUserId: string;
};

export type OutboundLike = {
  eventId: string;
  localActorId: string;
  localHandle: string;
  origin: string;
  postId: string;
  objectUri: string;
  remoteActorUri: string;
  inboxUrl: string;
  sharedInboxUrl: string | null;
};

export type OutboundLikeUndo = OutboundLike & {
  likeActivityId: string;
};

function validateOutboundLike(input: OutboundLike) {
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(input.eventId) ||
    !input.localActorId ||
    !input.localHandle ||
    !input.postId
  ) {
    throw new Error("Outbound Like identifiers are required.");
  }
  for (const [label, value] of [
    ["Liked object", input.objectUri],
    ["Remote actor", input.remoteActorUri],
    ["Remote inbox", input.inboxUrl],
  ]) {
    if (!isSafeRemoteUrl(value)) {
      throw new Error(`${label} must be a public HTTPS URL.`);
    }
  }
  if (input.sharedInboxUrl !== null && !isSafeRemoteUrl(input.sharedInboxUrl)) {
    throw new Error("Remote shared inbox must be a public HTTPS URL.");
  }
}

function outboundLikeActorUri(input: OutboundLike) {
  return new URL(`/users/${input.localHandle}`, input.origin).href;
}

export function createOutboundLikeActivity(input: OutboundLike) {
  const actor = outboundLikeActorUri(input);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`/activities/like/${input.eventId}`, input.origin).href,
    type: "Like",
    actor,
    object: input.objectUri,
    to: input.remoteActorUri,
  };
}

export function createOutboundLikeUndoActivity(input: OutboundLikeUndo) {
  const actor = outboundLikeActorUri(input);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`/activities/undo/${input.eventId}`, input.origin).href,
    type: "Undo",
    actor,
    object: input.likeActivityId,
    to: input.remoteActorUri,
  };
}

export function outboundLikeStatements(
  input: OutboundLike,
  now: string,
): Statement[] {
  validateOutboundLike(input);
  const activity = createOutboundLikeActivity(input);
  const targetInboxUrl = input.sharedInboxUrl ?? input.inboxUrl;
  return [
    {
      sql: "INSERT OR IGNORE INTO post_likes (post_id, actor_id, activity_id, created_at) VALUES (?, ?, ?, ?)",
      params: [input.postId, input.localActorId, activity.id, now],
    },
    {
      sql: "INSERT OR IGNORE INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'like', ?, 'Like', ?, 'direct', 'pending', NULL, ?, ?)",
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

export function outboundLikeUndoStatements(
  input: OutboundLikeUndo,
  now: string,
): Statement[] {
  validateOutboundLike(input);
  if (new URL(input.likeActivityId).origin !== new URL(input.origin).origin) {
    throw new Error("Like activity ID must belong to this instance.");
  }
  const activity = createOutboundLikeUndoActivity(input);
  const targetInboxUrl = input.sharedInboxUrl ?? input.inboxUrl;
  const activeLike = "post_id = ? AND actor_id = ? AND activity_id = ?";
  return [
    {
      sql: `INSERT OR IGNORE INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) SELECT ?, ?, 'like', ?, 'Undo', ?, 'direct', 'pending', NULL, ?, ? WHERE EXISTS (SELECT 1 FROM post_likes WHERE ${activeLike})`,
      params: [
        input.eventId,
        input.localActorId,
        input.likeActivityId,
        JSON.stringify(activity),
        now,
        now,
        input.postId,
        input.localActorId,
        input.likeActivityId,
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
      sql: `DELETE FROM post_likes WHERE ${activeLike}`,
      params: [input.postId, input.localActorId, input.likeActivityId],
    },
  ];
}

export function remoteLikeStatements(
  input: RemoteLike,
  now: string,
): Statement[] {
  const notificationId = crypto.randomUUID();
  return [
    {
      sql: "INSERT OR IGNORE INTO post_likes (post_id, actor_id, activity_id, created_at) VALUES (?, ?, ?, ?)",
      params: [input.postId, input.actorUri, input.activityId, now],
    },
    {
      sql: "INSERT INTO notifications (id, recipient_user_id, actor_id, type, thread_id, post_id, read_at, created_at) SELECT ?, ?, ?, 'like', ?, ?, NULL, ? WHERE ? != ? AND EXISTS (SELECT 1 FROM post_likes WHERE post_id = ? AND actor_id = ? AND activity_id = ?) AND NOT EXISTS (SELECT 1 FROM notifications WHERE recipient_user_id = ? AND actor_id = ? AND type = 'like' AND post_id = ?)",
      params: [
        notificationId,
        input.recipientUserId,
        input.actorUri,
        input.threadId,
        input.postId,
        now,
        input.recipientUserId,
        input.actorUri,
        input.postId,
        input.actorUri,
        input.activityId,
        input.recipientUserId,
        input.actorUri,
        input.postId,
      ],
    },
    {
      sql: "INSERT OR IGNORE INTO notification_push_outbox (id, notification_id, state, attempts, next_attempt_at, last_error, created_at, sent_at) SELECT ?, ?, 'pending', 0, ?, NULL, ?, NULL WHERE EXISTS (SELECT 1 FROM notifications WHERE id = ?)",
      params: [crypto.randomUUID(), notificationId, now, now, notificationId],
    },
  ];
}

export async function recordRemoteLike(
  database: D1Database,
  input: RemoteLike,
) {
  const now = new Date().toISOString();
  const results = await database.batch(
    remoteLikeStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
  return results[0]?.meta.changes === 1;
}

export async function undoRemoteLike(
  database: D1Database,
  input: { activityId: string; actorUri: string },
) {
  const result = await database
    .prepare("DELETE FROM post_likes WHERE activity_id = ? AND actor_id = ?")
    .bind(input.activityId, input.actorUri)
    .run();
  return result.meta.changes === 1;
}

export async function createOutboundLike(
  database: D1Database,
  input: OutboundLike,
) {
  const now = new Date().toISOString();
  await database.batch(
    outboundLikeStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
}

export async function undoOutboundLike(
  database: D1Database,
  input: OutboundLikeUndo,
) {
  const now = new Date().toISOString();
  const results = await database.batch(
    outboundLikeUndoStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
  return results.at(-1)?.meta.changes === 1;
}

type ExistingLike = { activityId: string | null };

export async function toggleOutboundLike(
  database: D1Database,
  input: OutboundLike,
) {
  const existing = await database
    .prepare(
      "SELECT activity_id AS activityId FROM post_likes WHERE post_id = ? AND actor_id = ? LIMIT 1",
    )
    .bind(input.postId, input.localActorId)
    .first<ExistingLike>();
  if (!existing) {
    await createOutboundLike(database, input);
    return "added" as const;
  }
  if (!existing.activityId) {
    await database
      .prepare("DELETE FROM post_likes WHERE post_id = ? AND actor_id = ?")
      .bind(input.postId, input.localActorId)
      .run();
    return "removed" as const;
  }
  await undoOutboundLike(database, {
    ...input,
    eventId: crypto.randomUUID(),
    likeActivityId: existing.activityId,
  });
  return "removed" as const;
}
