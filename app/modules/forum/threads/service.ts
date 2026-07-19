import { renderMarkdown } from "@/modules/forum/markdown/render";

export type NewThread = {
  threadId: string;
  postId: string;
  revisionId: string;
  boardId: string;
  authorUserId: string;
  title: string;
  markdown: string;
  visibility: "public" | "private";
};

export async function createThread(database: D1Database, input: NewThread) {
  const now = new Date().toISOString();
  const html = renderMarkdown(input.markdown);
  await database.batch([
    database
      .prepare(
        "INSERT INTO threads (id, board_id, title, first_post_id, is_pinned, is_locked, post_count, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, 0, 0, ?, ?, ?)",
      )
      .bind(input.threadId, input.boardId, input.title, now, now, now),
    database
      .prepare(
        "INSERT INTO posts (id, thread_id, parent_post_id, author_user_id, author_actor_id, origin, state, visibility, markdown, rendered_html, federation_object_id, published_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, NULL, 'local', 'published', ?, ?, ?, NULL, ?, ?, NULL)",
      )
      .bind(
        input.postId,
        input.threadId,
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
        "UPDATE threads SET first_post_id = ?, post_count = 1, last_activity_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(input.postId, now, now, input.threadId),
  ]);
}
