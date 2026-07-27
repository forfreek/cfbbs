import { noteId } from "./identifiers";
import { noteObject, type PublicPost } from "./note";
import { shouldFederatePost } from "./publication";
import {
  loadOwnedMediaByIds,
  loadPostAttachments,
  mediaRecordsToNoteAttachments,
  type MediaObjectRecord,
} from "@/modules/media";

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
  },
) {
  const media = await resolveNoteMedia(database, {
    postId: post.id,
    authorUserId: options.authorUserId,
    attachmentIds: options.attachmentIds,
  });
  return {
    ...post,
    attachments: mediaRecordsToNoteAttachments(origin, media),
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
