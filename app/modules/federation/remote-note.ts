import sanitizeHtml from "sanitize-html";

import { isSafeRemoteUrl } from "./remote-url";

type Statement = { sql: string; params: readonly unknown[] };

export type RemoteNote = {
  uri: string;
  actorUri: string;
  inReplyToUri: string | null;
  contentHtml: string;
  publishedAt: string;
  updatedAt: string | null;
};

export type FollowedRemoteNote = {
  uri: string;
  actorId: string;
  actorUri: string;
  actorName: string;
  contentHtml: string;
  publishedAt: string;
  updatedAt: string | null;
};

export type RemoteThreadReply = RemoteNote & {
  postId: string;
  threadId: string;
  parentPostId: string;
};

export type RemoteNoteDeletion = {
  uri: string;
  actorUri: string;
};

const allowedTags = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
];

export function sanitizeRemoteNoteHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags,
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["https", "http", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener" }),
    },
  }).trim();
}

function isTimestamp(value: string | null) {
  return value !== null && !Number.isNaN(new Date(value).getTime());
}

export function validateRemoteNote(input: RemoteNote) {
  if (!isSafeRemoteUrl(input.uri)) {
    return {
      ok: false as const,
      message: "Note ID must be a public HTTPS URL.",
    };
  }
  if (!isSafeRemoteUrl(input.actorUri)) {
    return {
      ok: false as const,
      message: "Note attribution must be a public HTTPS URL.",
    };
  }
  if (input.inReplyToUri !== null && input.inReplyToUri.length > 2_000) {
    return { ok: false as const, message: "Reply target is too long." };
  }
  if (!isTimestamp(input.publishedAt)) {
    return { ok: false as const, message: "Note published time is invalid." };
  }
  if (input.updatedAt !== null && !isTimestamp(input.updatedAt)) {
    return { ok: false as const, message: "Note updated time is invalid." };
  }
  if (input.contentHtml.length > 50_000) {
    return { ok: false as const, message: "Note content is too long." };
  }
  if (!sanitizeRemoteNoteHtml(input.contentHtml)) {
    return { ok: false as const, message: "Note content is empty." };
  }
  return { ok: true as const };
}

export function remoteNoteStatements(
  input: RemoteNote,
  now: string,
): Statement[] {
  const validation = validateRemoteNote(input);
  if (!validation.ok) throw new Error(validation.message);
  const retentionExpiresAt = new Date(
    new Date(now).getTime() + 90 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const contentHtml = sanitizeRemoteNoteHtml(input.contentHtml);
  return [
    {
      sql: "INSERT INTO federation_objects (id, uri, actor_id, type, in_reply_to_uri, content_html, published_at, updated_at, deleted_at, retention_expires_at, created_at) VALUES (?, ?, ?, 'Note', ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(uri) DO UPDATE SET actor_id = excluded.actor_id, type = excluded.type, in_reply_to_uri = excluded.in_reply_to_uri, content_html = excluded.content_html, published_at = excluded.published_at, updated_at = excluded.updated_at, deleted_at = NULL, retention_expires_at = excluded.retention_expires_at",
      params: [
        input.uri,
        input.uri,
        input.actorUri,
        input.inReplyToUri,
        contentHtml,
        input.publishedAt,
        input.updatedAt,
        retentionExpiresAt,
        now,
      ],
    },
  ];
}

export async function storeRemoteNote(database: D1Database, input: RemoteNote) {
  const now = new Date().toISOString();
  await database.batch(
    remoteNoteStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
}

export function remoteThreadReplyStatements(
  input: RemoteThreadReply,
  now: string,
): Statement[] {
  return [
    ...remoteNoteStatements(input, now),
    {
      sql: "UPDATE threads SET post_count = post_count + 1, last_activity_at = CASE WHEN last_activity_at < ? THEN ? ELSE last_activity_at END, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM posts WHERE federation_object_id = ?)",
      params: [
        input.publishedAt,
        input.publishedAt,
        now,
        input.threadId,
        input.uri,
      ],
    },
    {
      sql: "INSERT INTO posts (id, thread_id, parent_post_id, author_user_id, author_actor_id, origin, state, visibility, markdown, rendered_html, federation_object_id, published_at, updated_at, deleted_at) VALUES (?, ?, ?, NULL, ?, 'remote', 'published', 'public', '', ?, ?, ?, ?, NULL) ON CONFLICT(federation_object_id) DO UPDATE SET author_actor_id = excluded.author_actor_id, state = 'published', visibility = 'public', rendered_html = excluded.rendered_html, published_at = excluded.published_at, updated_at = excluded.updated_at, deleted_at = NULL",
      params: [
        input.postId,
        input.threadId,
        input.parentPostId,
        input.actorUri,
        sanitizeRemoteNoteHtml(input.contentHtml),
        input.uri,
        input.publishedAt,
        input.updatedAt ?? now,
      ],
    },
  ];
}

export async function storeRemoteThreadReply(
  database: D1Database,
  input: RemoteThreadReply,
) {
  const now = new Date().toISOString();
  await database.batch(
    remoteThreadReplyStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
}

export function remoteNoteDeleteStatements(
  input: RemoteNoteDeletion,
  now: string,
): Statement[] {
  if (!isSafeRemoteUrl(input.uri) || !isSafeRemoteUrl(input.actorUri)) {
    throw new Error("Remote Note deletion requires public HTTPS identifiers.");
  }
  const retentionExpiresAt = new Date(
    new Date(now).getTime() + 90 * 24 * 60 * 60 * 1_000,
  ).toISOString();
  return [
    {
      sql: "UPDATE threads SET post_count = CASE WHEN post_count > 0 THEN post_count - 1 ELSE 0 END, updated_at = ? WHERE id IN (SELECT posts.thread_id FROM posts INNER JOIN federation_objects ON federation_objects.uri = posts.federation_object_id WHERE posts.federation_object_id = ? AND posts.author_actor_id = ? AND posts.origin = 'remote' AND posts.state = 'published' AND federation_objects.actor_id = ? AND federation_objects.deleted_at IS NULL)",
      params: [now, input.uri, input.actorUri, input.actorUri],
    },
    {
      sql: "UPDATE posts SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE federation_object_id = ? AND author_actor_id = ? AND origin = 'remote' AND state = 'published' AND EXISTS (SELECT 1 FROM federation_objects WHERE federation_objects.uri = posts.federation_object_id AND federation_objects.actor_id = ? AND federation_objects.deleted_at IS NULL)",
      params: [now, now, input.uri, input.actorUri, input.actorUri],
    },
    {
      sql: "UPDATE federation_objects SET deleted_at = ?, retention_expires_at = ? WHERE uri = ? AND actor_id = ? AND type = 'Note' AND deleted_at IS NULL",
      params: [now, retentionExpiresAt, input.uri, input.actorUri],
    },
  ];
}

export async function deleteRemoteNote(
  database: D1Database,
  input: RemoteNoteDeletion,
) {
  const now = new Date().toISOString();
  const results = await database.batch(
    remoteNoteDeleteStatements(input, now).map((statement) =>
      database.prepare(statement.sql).bind(...statement.params),
    ),
  );
  return results.at(-1)?.meta.changes === 1;
}

const followedRemoteNotesQuery = `
  SELECT
    federation_objects.uri,
    federation_actors.id AS actorId,
    federation_actors.uri AS actorUri,
    federation_actors.name AS actorName,
    federation_objects.content_html AS contentHtml,
    federation_objects.published_at AS publishedAt,
    federation_objects.updated_at AS updatedAt
  FROM federation_objects
  INNER JOIN federation_actors
    ON federation_actors.id = federation_objects.actor_id
  INNER JOIN federation_follows
    ON federation_follows.following_actor_id = federation_actors.id
  WHERE federation_follows.follower_actor_id = ?
    AND federation_follows.state = 'accepted'
    AND federation_objects.type = 'Note'
    AND federation_objects.deleted_at IS NULL
    AND federation_actors.is_local = 0
    AND federation_actors.blocked_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM user_actor_preferences
      WHERE user_actor_preferences.user_id = ?
        AND user_actor_preferences.actor_id = federation_actors.id
    )
  ORDER BY federation_objects.published_at DESC, federation_objects.uri DESC
  LIMIT 50
`;

export async function listFollowedRemoteNotes(
  database: D1Database,
  localActorId: string,
) {
  return database
    .prepare(followedRemoteNotesQuery)
    .bind(localActorId, localActorId)
    .all<FollowedRemoteNote>();
}

export const remoteNoteQueries = { followedRemoteNotesQuery };
