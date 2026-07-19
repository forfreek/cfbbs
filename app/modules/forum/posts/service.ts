import { renderMarkdown } from "@/modules/forum/markdown/render";
import {
  publicPostOutboxStatement,
  type FederationPostPublication,
} from "@/modules/federation/outbox";
import { noteId } from "@/modules/federation/identifiers";

export type NewReply = {
  postId: string;
  revisionId: string;
  threadId: string;
  parentPostId: string;
  authorUserId: string;
  markdown: string;
  visibility: "public" | "private";
  federation?: FederationPostPublication;
};

export async function createReply(database: D1Database, input: NewReply) {
  const thread = await database
    .prepare(
      "SELECT threads.is_locked, first_post.author_user_id AS firstPostAuthorUserId FROM threads INNER JOIN posts AS first_post ON first_post.id = threads.first_post_id WHERE threads.id = ?",
    )
    .bind(input.threadId)
    .first<{ is_locked: number; firstPostAuthorUserId: string | null }>();
  if (!thread) throw new Error("Thread not found.");
  if (thread.is_locked) throw new Error("Thread is locked.");
  const now = new Date().toISOString();
  const html = renderMarkdown(input.markdown);
  const federationObjectId = input.federation
    ? noteId(input.federation.origin, input.postId)
    : null;
  const outbox = await publicPostOutboxStatement(database, {
    postId: input.postId,
    authorUserId: input.authorUserId,
    visibility: input.visibility,
    state: "published",
    origin: "local",
    html,
    publishedAt: now,
    updatedAt: now,
    parentPostId: input.parentPostId,
    publication: input.federation,
  });
  await database.batch([
    database
      .prepare(
        "INSERT INTO posts (id, thread_id, parent_post_id, author_user_id, author_actor_id, origin, state, visibility, markdown, rendered_html, federation_object_id, published_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL, 'local', 'published', ?, ?, ?, ?, ?, ?, NULL)",
      )
      .bind(
        input.postId,
        input.threadId,
        input.parentPostId,
        input.authorUserId,
        input.visibility,
        input.markdown,
        html,
        federationObjectId,
        now,
        now,
      ),
    database
      .prepare(
        "INSERT INTO post_revisions (id, post_id, markdown, rendered_html, editor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        input.revisionId,
        input.postId,
        input.markdown,
        html,
        input.authorUserId,
        now,
      ),
    database
      .prepare(
        "UPDATE threads SET post_count = post_count + 1, last_activity_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(now, now, input.threadId),
    ...(input.visibility === "public"
      ? [
          database
            .prepare(
              "INSERT INTO local_posts_fts (post_id, thread_id, title, body) SELECT ?, ?, title, ? FROM threads WHERE id = ?",
            )
            .bind(input.postId, input.threadId, input.markdown, input.threadId),
        ]
      : []),
    ...(thread.firstPostAuthorUserId &&
    thread.firstPostAuthorUserId !== input.authorUserId
      ? [
          database
            .prepare(
              "INSERT INTO notifications (id, recipient_user_id, actor_id, type, thread_id, post_id, read_at, created_at) SELECT ?, ?, ?, 'reply', ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM user_actor_preferences WHERE user_actor_preferences.user_id = ? AND user_actor_preferences.actor_id = ?)",
            )
            .bind(
              crypto.randomUUID(),
              thread.firstPostAuthorUserId,
              input.authorUserId,
              input.threadId,
              input.postId,
              now,
              thread.firstPostAuthorUserId,
              input.authorUserId,
            ),
        ]
      : []),
    ...(outbox ? [outbox] : []),
  ]);
}
