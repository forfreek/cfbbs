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
import { loadMentionedUserIds } from "@/modules/forum/mentions";
import { listThreadSubscriptionRecipients } from "@/modules/forum/subscriptions";
import { contentMetadataStatements } from "@/modules/forum/content";
import { pollInsertStatements } from "@/modules/forum/p2";

export type NewReply = {
  postId: string;
  revisionId: string;
  threadId: string;
  parentPostId: string;
  authorUserId: string;
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

export async function createReply(database: D1Database, input: NewReply) {
  if (input.quote && input.visibility !== "public") {
    throw new Error("私密帖子不能包含公开引用。");
  }
  const existingStatement = database
    .prepare(
      "SELECT id, thread_id AS threadId, author_user_id AS authorUserId FROM posts WHERE id = ? LIMIT 1",
    )
    .bind(input.postId) as unknown as {
    first?: <T>() => Promise<T | null>;
  };
  const existing = existingStatement.first
    ? await existingStatement.first<{
        id: string;
        threadId: string;
        authorUserId: string | null;
      }>()
    : null;
  if (existing) {
    if (
      existing.threadId === input.threadId &&
      existing.authorUserId === input.authorUserId
    ) {
      return { postId: existing.id, duplicate: true as const };
    }
    throw new Error("帖子提交标识已被使用。");
  }
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
    parentPostId: input.parentPostId,
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
  const mentionedUserIds = await loadMentionedUserIds(database, input.markdown);
  const metadata = await contentMetadataStatements(database, {
    postId: input.postId,
    markdown: input.markdown,
    createdAt: now,
  });
  const subscriptionRecipients = await listThreadSubscriptionRecipients(
    database,
    input.threadId,
  );
  const notificationRows = new Map<
    string,
    { id: string; type: "reply" | "mention" | "thread-reply" }
  >();
  if (
    thread.firstPostAuthorUserId &&
    thread.firstPostAuthorUserId !== input.authorUserId
  ) {
    notificationRows.set(thread.firstPostAuthorUserId, {
      id: crypto.randomUUID(),
      type: "reply",
    });
  }
  for (const userId of mentionedUserIds) {
    if (userId !== input.authorUserId) {
      notificationRows.set(userId, {
        id: crypto.randomUUID(),
        type: "mention",
      });
    }
  }
  for (const recipient of subscriptionRecipients.results) {
    if (recipient.userId === input.authorUserId) continue;
    if (
      recipient.mode === "mentions" &&
      !mentionedUserIds.includes(recipient.userId)
    )
      continue;
    if (notificationRows.has(recipient.userId)) continue;
    notificationRows.set(recipient.userId, {
      id: crypto.randomUUID(),
      type: "thread-reply",
    });
  }
  const notificationStatements = [...notificationRows.entries()].flatMap(
    ([recipientUserId, notification]) => [
      database
        .prepare(
          "INSERT INTO notifications (id, recipient_user_id, actor_id, type, thread_id, post_id, read_at, created_at) SELECT ?, ?, ?, ?, ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM user_actor_preferences WHERE user_actor_preferences.user_id = ? AND user_actor_preferences.actor_id = ?)",
        )
        .bind(
          notification.id,
          recipientUserId,
          input.authorUserId,
          notification.type,
          input.threadId,
          input.postId,
          now,
          recipientUserId,
          input.authorUserId,
        ),
      database
        .prepare(
          "INSERT OR IGNORE INTO notification_push_outbox (id, notification_id, state, attempts, next_attempt_at, last_error, created_at, sent_at) SELECT ?, ?, 'pending', 0, ?, NULL, ?, NULL WHERE EXISTS (SELECT 1 FROM notifications WHERE id = ?)",
        )
        .bind(crypto.randomUUID(), notification.id, now, now, notification.id),
    ],
  );
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
    ...postAttachmentInsertStatements(database, {
      postId: input.postId,
      attachmentIds,
      createdAt: now,
    }),
    ...(input.visibility === "public"
      ? [
          database
            .prepare(
              "INSERT INTO local_posts_fts (post_id, thread_id, title, body) SELECT ?, ?, title, ? FROM threads WHERE id = ?",
            )
            .bind(input.postId, input.threadId, input.markdown, input.threadId),
        ]
      : []),
    ...notificationStatements,
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
  return { postId: input.postId, duplicate: false as const };
}
