import { noteId } from "./identifiers";
import { noteObject, type PublicPost } from "./note";
import { shouldFederatePost } from "./publication";
import {
  loadOwnedMediaByIds,
  loadPostAttachments,
  mediaRecordsToNoteAttachments,
  type MediaObjectRecord,
} from "@/modules/media";
import { extractContentTokens } from "@/modules/forum/mentions";

export type FederationPostPublication = {
  eventId: string;
  actorId: string;
  origin: string;
};

type PostOutboxInput = {
  postId: string;
  authorUserId: string;
  visibility: "public" | "private";
  state: "published" | "hidden" | "deleted";
  origin: "local" | "remote";
  html: string;
  publishedAt: string;
  updatedAt: string;
  parentPostId: string | null;
  attachmentIds?: readonly string[];
  markdown?: string;
  poll?: {
    multiple: boolean;
    closesAt: string | null;
    options: readonly string[];
  };
  publication?: FederationPostPublication;
};

type PostUpdateOutboxInput = Omit<PostOutboxInput, "state"> & {
  publication?: FederationPostPublication;
};

type PostDeleteOutboxInput = {
  postId: string;
  authorUserId: string;
  visibility: "public" | "private";
  origin: "local" | "remote";
  publication?: FederationPostPublication;
};

type AuthorHandle = { handle: string };

function createActivityId(origin: string, postId: string) {
  noteId(origin, postId);
  return new URL(`/activities/create/${postId}`, origin).href;
}

function activityId(
  origin: string,
  kind: "update" | "delete",
  postId: string,
  eventId: string,
) {
  noteId(origin, postId);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId)) {
    throw new Error("Invalid federation event ID.");
  }
  return new URL(`/activities/${kind}/${postId}/${eventId}`, origin).href;
}

export function createNoteActivity(origin: string, post: PublicPost) {
  const object = noteObject(origin, post);
  return {
    "@context": object["@context"],
    id: createActivityId(origin, post.id),
    type: "Create",
    actor: object.attributedTo,
    to: object.to,
    object,
  };
}

export function createNoteUpdateActivity(
  origin: string,
  eventId: string,
  post: PublicPost,
) {
  const object = noteObject(origin, post);
  return {
    "@context": object["@context"],
    id: activityId(origin, "update", post.id, eventId),
    type: "Update",
    actor: object.attributedTo,
    to: object.to,
    object,
  };
}

export function createNoteDeleteActivity(
  origin: string,
  eventId: string,
  input: { postId: string; authorHandle: string },
) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityId(origin, "delete", input.postId, eventId),
    type: "Delete",
    actor: new URL(`/users/${input.authorHandle}`, origin).href,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    object: noteId(origin, input.postId),
  };
}

export function createAnnounceActivity(input: {
  origin: string;
  actorHandle: string;
  activityId: string;
  objectUri: string;
}) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: new URL(`/activities/announce/${input.activityId}`, input.origin).href,
    type: "Announce",
    actor: new URL(`/users/${input.actorHandle}`, input.origin).href,
    object: input.objectUri,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };
}

export function createUndoAnnounceActivity(input: {
  origin: string;
  actorHandle: string;
  activityId: string;
  objectUri: string;
}) {
  const announce = createAnnounceActivity(input);
  return {
    "@context": announce["@context"],
    id: new URL(`/activities/undo-announce/${input.activityId}`, input.origin)
      .href,
    type: "Undo",
    actor: announce.actor,
    object: announce,
    to: announce.to,
  };
}

export function createEmojiReactActivity(input: {
  origin: string;
  actorHandle: string;
  activityId: string;
  objectUri: string;
  emoji: string;
}) {
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/fep/c0e0",
    ],
    id: new URL(`/activities/react/${input.activityId}`, input.origin).href,
    type: "EmojiReact",
    actor: new URL(`/users/${input.actorHandle}`, input.origin).href,
    object: input.objectUri,
    name: input.emoji,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };
}

export function createUndoEmojiReactActivity(input: {
  origin: string;
  actorHandle: string;
  activityId: string;
  objectUri: string;
  emoji: string;
}) {
  const reaction = createEmojiReactActivity(input);
  return {
    "@context": reaction["@context"],
    id: new URL(`/activities/undo-react/${input.activityId}`, input.origin)
      .href,
    type: "Undo",
    actor: reaction.actor,
    object: reaction,
    to: reaction.to,
  };
}

async function resolveNoteMedia(
  database: D1Database,
  input: {
    postId: string;
    authorUserId: string;
    attachmentIds?: readonly string[];
  },
) {
  if (input.attachmentIds) {
    if (input.attachmentIds.length === 0) return [] as MediaObjectRecord[];
    const owned = await loadOwnedMediaByIds(database, {
      authorUserId: input.authorUserId,
      attachmentIds: input.attachmentIds,
    });
    if (!owned) {
      throw new Error("Public post attachments must belong to the author.");
    }
    return owned;
  }
  const attachments = await loadPostAttachments(database, [input.postId]);
  return attachments.get(input.postId) ?? [];
}

async function publicPostWithAttachments(
  database: D1Database,
  origin: string,
  post: PublicPost,
  options: {
    authorUserId: string;
    attachmentIds?: readonly string[];
    markdown?: string;
    poll?: {
      multiple: boolean;
      closesAt: string | null;
      options: readonly string[];
    };
  },
) {
  const media = await resolveNoteMedia(database, {
    postId: post.id,
    authorUserId: options.authorUserId,
    attachmentIds: options.attachmentIds,
  });
  const metadataProbe = database
    .prepare("SELECT id FROM hashtags LIMIT 1")
    .bind();
  if (typeof metadataProbe.all !== "function") {
    return {
      ...post,
      attachments: mediaRecordsToNoteAttachments(origin, media),
    };
  }
  const [tags, mentions, quote, storedPoll] = await Promise.all([
    database
      .prepare(
        "SELECT hashtags.tag, hashtags.display_name AS displayName FROM post_hashtags INNER JOIN hashtags ON hashtags.id = post_hashtags.hashtag_id WHERE post_hashtags.post_id = ? ORDER BY hashtags.tag",
      )
      .bind(post.id)
      .all<{ tag: string; displayName: string }>(),
    database
      .prepare(
        "SELECT federation_actors.uri AS href, '@' || post_mentions.handle AS name FROM post_mentions INNER JOIN user ON user.id = post_mentions.mentioned_user_id INNER JOIN federation_actors ON federation_actors.id = user.id WHERE post_mentions.post_id = ?",
      )
      .bind(post.id)
      .all<{ href: string; name: string }>(),
    database
      .prepare(
        "SELECT target_uri AS uri, snapshot_html AS html, snapshot_title AS title FROM post_quotes WHERE post_id = ? LIMIT 1",
      )
      .bind(post.id)
      .first<{ uri: string; html: string | null; title: string | null }>(),
    database
      .prepare(
        "SELECT polls.multiple, polls.closes_at AS closesAt, poll_options.label AS name, COUNT(poll_votes.user_id) AS votesCount FROM polls INNER JOIN poll_options ON poll_options.poll_post_id = polls.post_id LEFT JOIN poll_votes ON poll_votes.option_id = poll_options.id WHERE polls.post_id = ? GROUP BY poll_options.id ORDER BY poll_options.position",
      )
      .bind(post.id)
      .all<{
        multiple: number;
        closesAt: string | null;
        name: string;
        votesCount: number;
      }>(),
  ]);
  const derived = options.markdown
    ? extractContentTokens(options.markdown)
    : null;
  const mentionRows =
    derived && derived.mentions.length > 0
      ? await database
          .prepare(
            `SELECT federation_actors.uri AS href, '@' || profiles.handle AS name FROM profiles INNER JOIN federation_actors ON federation_actors.id = profiles.user_id WHERE profiles.handle IN (${derived.mentions.map(() => "?").join(",")}) AND federation_actors.is_local = 1`,
          )
          .bind(...derived.mentions)
          .all<{ href: string; name: string }>()
      : null;
  return {
    ...post,
    attachments: mediaRecordsToNoteAttachments(origin, media),
    hashtags: derived?.hashtags ?? tags.results,
    mentions: mentionRows?.results ?? mentions.results,
    quote: quote
      ? {
          uri: quote.uri,
          html: quote.html ?? undefined,
          title: quote.title ?? undefined,
        }
      : null,
    poll: options.poll
      ? {
          multiple: options.poll.multiple,
          closesAt: options.poll.closesAt,
          options: options.poll.options.map((name) => ({ name })),
        }
      : storedPoll.results.length
        ? {
            multiple: Boolean(storedPoll.results[0].multiple),
            closesAt: storedPoll.results[0].closesAt,
            options: storedPoll.results.map(({ name, votesCount }) => ({
              name,
              votesCount: Number(votesCount),
            })),
          }
        : null,
  };
}

async function loadAuthorHandle(database: D1Database, userId: string) {
  return database
    .prepare("SELECT handle FROM profiles WHERE user_id = ?")
    .bind(userId)
    .first<AuthorHandle>();
}

function replacePostEventStatements(
  database: D1Database,
  input: {
    eventId: string;
    actorId: string;
    postId: string;
    activityType: "Update" | "Delete";
    activity: unknown;
    now: string;
  },
) {
  return [
    database
      .prepare(
        "DELETE FROM federation_deliveries WHERE outbox_event_id IN (SELECT id FROM federation_outbox_events WHERE aggregate_type = 'post' AND aggregate_id = ? AND activity_type = ?)",
      )
      .bind(input.postId, input.activityType),
    database
      .prepare(
        "DELETE FROM federation_outbox_events WHERE aggregate_type = 'post' AND aggregate_id = ? AND activity_type = ?",
      )
      .bind(input.postId, input.activityType),
    database
      .prepare(
        "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'post', ?, ?, ?, 'followers', 'pending', NULL, ?, ?)",
      )
      .bind(
        input.eventId,
        input.actorId,
        input.postId,
        input.activityType,
        JSON.stringify(input.activity),
        input.now,
        input.now,
      ),
  ];
}

export async function publicPostOutboxStatement(
  database: D1Database,
  input: PostOutboxInput,
) {
  if (!shouldFederatePost(input)) return null;
  if (!input.publication) {
    throw new Error("Public local posts require federation publication data.");
  }
  if (input.publication.actorId !== input.authorUserId) {
    throw new Error("A local post must use its author's federation actor.");
  }

  const author = await loadAuthorHandle(database, input.authorUserId);
  if (!author) throw new Error("Local post author profile not found.");

  const activity = createNoteActivity(
    input.publication.origin,
    await publicPostWithAttachments(
      database,
      input.publication.origin,
      {
        id: input.postId,
        authorHandle: author.handle,
        html: input.html,
        publishedAt: input.publishedAt,
        updatedAt: input.updatedAt,
        parentPostId: input.parentPostId,
      },
      {
        authorUserId: input.authorUserId,
        attachmentIds: input.attachmentIds,
        markdown: input.markdown,
        poll: input.poll,
      },
    ),
  );
  return database
    .prepare(
      "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, delivery_scope, state, queued_at, created_at, updated_at) VALUES (?, ?, 'post', ?, 'Create', ?, 'followers', 'pending', NULL, ?, ?)",
    )
    .bind(
      input.publication.eventId,
      input.publication.actorId,
      input.postId,
      JSON.stringify(activity),
      input.publishedAt,
      input.updatedAt,
    );
}

export async function publicPostUpdateOutboxStatements(
  database: D1Database,
  input: PostUpdateOutboxInput,
) {
  if (
    !shouldFederatePost({
      visibility: input.visibility,
      state: "published",
      origin: input.origin,
    })
  ) {
    return [];
  }
  if (!input.publication) {
    throw new Error("Public local post updates require federation data.");
  }
  if (input.publication.actorId !== input.authorUserId) {
    throw new Error(
      "A local post update must use its author's federation actor.",
    );
  }
  const author = await loadAuthorHandle(database, input.authorUserId);
  if (!author) throw new Error("Local post author profile not found.");
  const activity = createNoteUpdateActivity(
    input.publication.origin,
    input.publication.eventId,
    await publicPostWithAttachments(
      database,
      input.publication.origin,
      {
        id: input.postId,
        authorHandle: author.handle,
        html: input.html,
        publishedAt: input.publishedAt,
        updatedAt: input.updatedAt,
        parentPostId: input.parentPostId,
      },
      {
        authorUserId: input.authorUserId,
        attachmentIds: input.attachmentIds,
        markdown: input.markdown,
        poll: input.poll,
      },
    ),
  );
  return replacePostEventStatements(database, {
    eventId: input.publication.eventId,
    actorId: input.authorUserId,
    postId: input.postId,
    activityType: "Update",
    activity,
    now: input.updatedAt,
  });
}

export async function publicPostDeleteOutboxStatements(
  database: D1Database,
  input: PostDeleteOutboxInput,
) {
  if (input.visibility !== "public" || input.origin !== "local") return [];
  if (!input.publication) {
    throw new Error("Public local post deletions require federation data.");
  }
  if (input.publication.actorId !== input.authorUserId) {
    throw new Error(
      "A local post deletion must use its author's federation actor.",
    );
  }
  const author = await loadAuthorHandle(database, input.authorUserId);
  if (!author) throw new Error("Local post author profile not found.");
  const now = new Date().toISOString();
  const activity = createNoteDeleteActivity(
    input.publication.origin,
    input.publication.eventId,
    {
      postId: input.postId,
      authorHandle: author.handle,
    },
  );
  return replacePostEventStatements(database, {
    eventId: input.publication.eventId,
    actorId: input.authorUserId,
    postId: input.postId,
    activityType: "Delete",
    activity,
    now,
  });
}
