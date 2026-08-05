import { renderMarkdown } from "@/modules/forum/markdown/render";
import {
  publicPostOutboxStatement,
  type FederationPostPublication,
} from "@/modules/federation/outbox";
import { noteId } from "@/modules/federation/identifiers";
import {
  loadOwnedMediaByIds,
  postAttachmentInsertStatements,
} from "@/modules/media";
import { contentMetadataStatements } from "@/modules/forum/content";
import { pollInsertStatements } from "@/modules/forum/p2";

export type NewThread = {
  threadId: string;
  postId: string;
  revisionId: string;
  boardId: string;
  authorUserId: string;
  title: string;
  markdown: string;
  visibility: "public" | "private";
  attachmentIds?: readonly string[];
  federation?: FederationPostPublication;
  poll?: {
    multiple: boolean;
    closesAt: string | null;
    options: readonly string[];
  };
  quote?: {
    targetPostId: string | null;
    targetUri: string;
    snapshotHtml?: string | null;
    snapshotTitle?: string | null;
  } | null;
};

export async function createThread(database: D1Database, input: NewThread) {
  if (input.quote && input.visibility !== "public") {
    throw new Error("私密帖子不能包含公开引用。");
  }
  const existingStatement = database
    .prepare(
      "SELECT threads.id, posts.id AS postId, posts.author_user_id AS authorUserId FROM threads INNER JOIN posts ON posts.id = threads.first_post_id WHERE threads.id = ? OR posts.id = ? LIMIT 1",
    )
    .bind(input.threadId, input.postId) as unknown as {
    first?: <T>() => Promise<T | null>;
  };
  const existing = existingStatement.first
    ? await existingStatement.first<{
        id: string;
        postId: string;
        authorUserId: string | null;
      }>()
    : null;
  if (existing) {
    if (
      existing.authorUserId === input.authorUserId &&
      existing.id === input.threadId &&
      existing.postId === input.postId
    ) {
      return {
        threadId: existing.id,
        postId: existing.postId,
        duplicate: true as const,
      };
    }
    throw new Error("主题提交标识已被使用。");
  }
  const now = new Date().toISOString();
  const html = renderMarkdown(input.markdown);
  const attachmentIds = input.attachmentIds ?? [];
  if (attachmentIds.length > 0) {
    const owned = await loadOwnedMediaByIds(database, {
      authorUserId: input.authorUserId,
      attachmentIds,
    });
    if (!owned) {
      throw new Error("只能使用自己上传且未删除的附件。");
    }
  }
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
    parentPostId: null,
    attachmentIds,
    markdown: input.markdown,
    poll: input.poll,
    quote: input.quote
      ? {
          uri: input.quote.targetUri,
          html: input.quote.snapshotHtml,
          title: input.quote.snapshotTitle,
        }
      : null,
    publication: input.federation,
  });
  const metadata = await contentMetadataStatements(database, {
    postId: input.postId,
    markdown: input.markdown,
    createdAt: now,
  });
  await database.batch([
    database
      .prepare(
        "INSERT INTO threads (id, board_id, title, first_post_id, is_pinned, is_locked, post_count, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, 0, 0, ?, ?, ?)",
      )
      .bind(input.threadId, input.boardId, input.title, now, now, now),
    database
      .prepare(
        "INSERT INTO posts (id, thread_id, parent_post_id, author_user_id, author_actor_id, origin, state, visibility, markdown, rendered_html, federation_object_id, published_at, updated_at, deleted_at) VALUES (?, ?, NULL, ?, NULL, 'local', 'published', ?, ?, ?, ?, ?, ?, NULL)",
      )
      .bind(
        input.postId,
        input.threadId,
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
        "UPDATE threads SET first_post_id = ?, post_count = 1, last_activity_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(input.postId, now, now, input.threadId),
    ...postAttachmentInsertStatements(database, {
      postId: input.postId,
      attachmentIds,
      createdAt: now,
    }),
    ...(input.visibility === "public"
      ? [
          database
            .prepare(
              "INSERT INTO local_posts_fts (post_id, thread_id, title, body) VALUES (?, ?, ?, ?)",
            )
            .bind(input.postId, input.threadId, input.title, input.markdown),
        ]
      : []),
    ...(outbox ? [outbox] : []),
    ...metadata.statements,
    ...(input.quote
      ? [
          database
            .prepare(
              "INSERT OR IGNORE INTO post_quotes (id, post_id, target_post_id, target_uri, snapshot_html, snapshot_title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              crypto.randomUUID(),
              input.postId,
              input.quote.targetPostId,
              input.quote.targetUri,
              input.quote.snapshotHtml ?? null,
              input.quote.snapshotTitle ?? null,
              now,
            ),
        ]
      : []),
    ...(input.poll
      ? pollInsertStatements(database, {
          postId: input.postId,
          ...input.poll,
          createdAt: now,
        })
      : []),
  ]);
  return {
    threadId: input.threadId,
    postId: input.postId,
    duplicate: false as const,
  };
}
