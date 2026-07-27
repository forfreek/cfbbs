import { renderMarkdown } from "@/modules/forum/markdown/render";
import {
  publicPostDeleteOutboxStatements,
  publicPostUpdateOutboxStatements,
  type FederationPostPublication,
} from "@/modules/federation/outbox";
import { softDeletePostMediaLinks } from "@/modules/media";

export type MutableForumPost = {
  id: string;
  threadId: string;
  boardId: string;
  firstPostId: string;
  authorUserId: string | null;
  origin: "local" | "remote";
  state: "published" | "hidden" | "deleted";
  visibility: "public" | "private";
  markdown: string;
  federationObjectId: string | null;
  publishedAt: string;
  parentPostId: string | null;
  threadTitle: string;
};

export async function loadMutableForumPost(
  database: D1Database,
  postId: string,
) {
  return database
    .prepare(
      "SELECT posts.id, posts.thread_id AS threadId, threads.board_id AS boardId, threads.first_post_id AS firstPostId, threads.title AS threadTitle, posts.author_user_id AS authorUserId, posts.origin, posts.state, posts.visibility, posts.markdown, posts.federation_object_id AS federationObjectId, posts.published_at AS publishedAt, posts.parent_post_id AS parentPostId FROM posts INNER JOIN threads ON threads.id = posts.thread_id WHERE posts.id = ? LIMIT 1",
    )
    .bind(postId)
    .first<MutableForumPost>();
}

export type LocalPostEdit = {
  postId: string;
  threadId: string;
  firstPostId: string;
  authorUserId: string;
  markdown: string;
  title?: string;
  visibility: "public" | "private";
  publishedAt: string;
  parentPostId: string | null;
  revisionId: string;
  attachmentIds?: readonly string[];
  federation?: FederationPostPublication;
};

export async function editLocalPost(
  database: D1Database,
  input: LocalPostEdit,
) {
  const now = new Date().toISOString();
  const html = renderMarkdown(input.markdown);
  const title = input.title?.trim();
  if (title !== undefined && (title.length < 1 || title.length > 200)) {
    throw new Error("Thread title must be between 1 and 200 characters.");
  }
  const outbox = await publicPostUpdateOutboxStatements(database, {
    postId: input.postId,
    authorUserId: input.authorUserId,
    visibility: input.visibility,
    origin: "local",
    html,
    publishedAt: input.publishedAt,
    updatedAt: now,
    parentPostId: input.parentPostId,
    attachmentIds: input.attachmentIds,
    publication: input.federation,
  });
  await database.batch([
    database
      .prepare(
        "UPDATE posts SET markdown = ?, rendered_html = ?, updated_at = ? WHERE id = ? AND origin = 'local' AND state = 'published'",
      )
      .bind(input.markdown, html, now, input.postId),
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
    ...(title !== undefined
      ? [
          database
            .prepare(
              "UPDATE threads SET title = ?, updated_at = ? WHERE id = ? AND first_post_id = ?",
            )
            .bind(title, now, input.threadId, input.firstPostId),
        ]
      : []),
    ...(input.visibility === "public"
      ? [
          database
            .prepare("DELETE FROM local_posts_fts WHERE post_id = ?")
            .bind(input.postId),
          database
            .prepare(
              "INSERT INTO local_posts_fts (post_id, thread_id, title, body) SELECT ?, ?, title, ? FROM threads WHERE id = ?",
            )
            .bind(input.postId, input.threadId, input.markdown, input.threadId),
        ]
      : []),
    ...outbox,
  ]);
}

export type LocalPostDeletion = {
  postId: string;
  threadId: string;
  authorUserId: string;
  visibility: "public" | "private";
  federation?: FederationPostPublication;
};

export async function softDeleteLocalPost(
  database: D1Database,
  input: LocalPostDeletion,
) {
  const now = new Date().toISOString();
  const outbox = await publicPostDeleteOutboxStatements(database, {
    postId: input.postId,
    authorUserId: input.authorUserId,
    visibility: input.visibility,
    origin: "local",
    publication: input.federation,
  });
  const results = await database.batch([
    database
      .prepare(
        "UPDATE posts SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND origin = 'local' AND state != 'deleted'",
      )
      .bind(now, now, input.postId),
    database
      .prepare("DELETE FROM local_posts_fts WHERE post_id = ?")
      .bind(input.postId),
    database
      .prepare(
        "UPDATE threads SET post_count = CASE WHEN post_count > 0 THEN post_count - 1 ELSE 0 END, updated_at = ? WHERE id = ?",
      )
      .bind(now, input.threadId),
    database
      .prepare("DELETE FROM post_attachments WHERE post_id = ?")
      .bind(input.postId),
    ...outbox,
  ]);
  return results[0]?.meta.changes === 1;
}

export async function softDeletePost(database: D1Database, postId: string) {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      "UPDATE posts SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND state != 'deleted'",
    )
    .bind(now, now, postId)
    .run();
  await database
    .prepare("DELETE FROM local_posts_fts WHERE post_id = ?")
    .bind(postId)
    .run();
  await softDeletePostMediaLinks(database, postId);
  return result.meta.changes > 0;
}
