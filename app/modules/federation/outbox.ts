import { noteId } from "./identifiers";
import { noteObject, type PublicPost } from "./note";
import { shouldFederatePost } from "./publication";

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
  publication?: FederationPostPublication;
};

type AuthorHandle = { handle: string };

function createActivityId(origin: string, postId: string) {
  noteId(origin, postId);
  return new URL(`/activities/create/${postId}`, origin).href;
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

  const author = await database
    .prepare("SELECT handle FROM profiles WHERE user_id = ?")
    .bind(input.authorUserId)
    .first<AuthorHandle>();
  if (!author) throw new Error("Local post author profile not found.");

  const activity = createNoteActivity(input.publication.origin, {
    id: input.postId,
    authorHandle: author.handle,
    html: input.html,
    publishedAt: input.publishedAt,
    updatedAt: input.updatedAt,
    parentPostId: input.parentPostId,
  });
  return database
    .prepare(
      "INSERT INTO federation_outbox_events (id, actor_id, aggregate_type, aggregate_id, activity_type, activity_json, state, queued_at, created_at, updated_at) VALUES (?, ?, 'post', ?, 'Create', ?, 'pending', NULL, ?, ?)",
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
