import { renderMarkdown } from "@/modules/forum/markdown/render";
import {
  publicPostOutboxStatement,
  type FederationPostPublication,
} from "@/modules/federation/outbox";

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
    .prepare("SELECT is_locked FROM threads WHERE id = ?")
    .bind(input.threadId)
    .first<{ is_locked: number }>();
  if (!thread) throw new Error("Thread not found.");
  if (thread.is_locked) throw new Error("Thread is locked.");
  const now = new Date().toISOString();
  const html = renderMarkdown(input.markdown);
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
        "INSERT INTO posts (id, thread_id, parent_post_id, author_user_id, author_actor_id, origin, state, visibility, markdown, rendered_html, federation_object_id, published_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL, 'local', 'published', ?, ?, ?, NULL, ?, ?, NULL)",
      )
      .bind(
        input.postId,
        input.threadId,
        input.parentPostId,
        input.authorUserId,
        input.visibility,
        input.markdown,
        html,
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
    ...(outbox ? [outbox] : []),
  ]);
}
