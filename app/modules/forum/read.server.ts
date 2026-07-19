import {
  blockedInstanceDomainsForRemoteUris,
  remoteInstanceDomain,
} from "@/modules/moderation/instance-policy";

export type ForumBoard = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  description: string;
  mode: "container" | "posting" | "read_only";
  visibility: "public" | "private";
};

export type ForumThread = {
  id: string;
  boardId: string;
  firstPostId: string;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  firstPostVisibility: "public" | "private";
  createdAt: string;
};

export type ForumThreadSummary = ForumThread & {
  authorHandle: string | null;
  authorName: string | null;
  replyCount: number;
  activityAt: string;
};

export type ForumThreadCursor = {
  pinned: 0 | 1;
  activityAt: string;
  id: string;
};

export type ForumPost = {
  id: string;
  threadId: string;
  parentPostId: string | null;
  authorUserId: string | null;
  authorHandle: string | null;
  authorName: string | null;
  authorActorUri: string | null;
  renderedHtml: string;
  visibility: "public" | "private";
  likeCount: number;
  viewerLiked: boolean;
  publishedAt: string;
  updatedAt: string;
};

export async function loadForumBoard(database: D1Database, boardId: string) {
  return database
    .prepare(
      "SELECT id, parent_id AS parentId, slug, title, description, mode, visibility FROM boards WHERE id = ?",
    )
    .bind(boardId)
    .first<ForumBoard>();
}

export async function loadForumThread(database: D1Database, threadId: string) {
  return database
    .prepare(
      "SELECT threads.id, threads.board_id AS boardId, threads.first_post_id AS firstPostId, threads.title, threads.is_pinned AS isPinned, threads.is_locked AS isLocked, first_post.visibility AS firstPostVisibility, threads.created_at AS createdAt FROM threads INNER JOIN posts AS first_post ON first_post.id = threads.first_post_id WHERE threads.id = ? AND first_post.state = 'published'",
    )
    .bind(threadId)
    .first<ForumThread>();
}

export function encodeForumThreadCursor(cursor: ForumThreadCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeForumThreadCursor(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    const parsed: unknown = JSON.parse(json);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("pinned" in parsed) ||
      !("activityAt" in parsed) ||
      !("id" in parsed)
    ) {
      return null;
    }

    const cursor = parsed as Record<string, unknown>;
    if (
      (cursor.pinned !== 0 && cursor.pinned !== 1) ||
      typeof cursor.activityAt !== "string" ||
      cursor.activityAt.length === 0 ||
      typeof cursor.id !== "string" ||
      cursor.id.length === 0
    ) {
      return null;
    }

    return {
      pinned: cursor.pinned,
      activityAt: cursor.activityAt,
      id: cursor.id,
    } as ForumThreadCursor;
  } catch {
    return null;
  }
}

export async function listForumBoardThreads(
  database: D1Database,
  boardId: string,
  includePrivate: boolean,
  cursor: ForumThreadCursor | null = null,
) {
  const pageSize = 50;
  const visiblePosts = includePrivate
    ? ""
    : "AND first_post.visibility = 'public'";
  const visibleReplies = includePrivate
    ? ""
    : "AND reply.visibility = 'public'";
  const visibleActivity = includePrivate
    ? ""
    : "AND activity_post.visibility = 'public'";
  const cursorPredicate = cursor
    ? "WHERE isPinned < ? OR (isPinned = ? AND (activityAt < ? OR (activityAt = ? AND id < ?)))"
    : "";
  const statement = database
    .prepare(
      `WITH visible_threads AS (SELECT threads.id, threads.board_id AS boardId, threads.first_post_id AS firstPostId, threads.title, threads.is_pinned AS isPinned, threads.is_locked AS isLocked, first_post.visibility AS firstPostVisibility, threads.created_at AS createdAt, profiles.handle AS authorHandle, profiles.display_name AS authorName, (SELECT COUNT(*) FROM posts AS reply WHERE reply.thread_id = threads.id AND reply.id != threads.first_post_id AND reply.state = 'published' ${visibleReplies}) AS replyCount, (SELECT MAX(activity_post.published_at) FROM posts AS activity_post WHERE activity_post.thread_id = threads.id AND activity_post.state = 'published' ${visibleActivity}) AS activityAt FROM threads INNER JOIN posts AS first_post ON first_post.id = threads.first_post_id LEFT JOIN profiles ON profiles.user_id = first_post.author_user_id WHERE threads.board_id = ? AND first_post.state = 'published' ${visiblePosts}) SELECT * FROM visible_threads ${cursorPredicate} ORDER BY isPinned DESC, activityAt DESC, id DESC LIMIT ?`,
    )
    .bind(
      boardId,
      ...(cursor
        ? [
            cursor.pinned,
            cursor.pinned,
            cursor.activityAt,
            cursor.activityAt,
            cursor.id,
          ]
        : []),
      pageSize + 1,
    );
  const page = await statement.all<ForumThreadSummary>();
  const results = page.results.slice(0, pageSize);
  const finalThread = results.at(-1);

  return {
    ...page,
    results,
    nextCursor:
      page.results.length > pageSize && finalThread
        ? encodeForumThreadCursor({
            pinned: finalThread.isPinned ? 1 : 0,
            activityAt: finalThread.activityAt,
            id: finalThread.id,
          })
        : null,
  };
}

export async function listForumThreadPosts(
  database: D1Database,
  threadId: string,
  includePrivate: boolean,
  viewerActorId: string | null = null,
) {
  const visibility = includePrivate ? "" : "AND posts.visibility = 'public'";
  const posts = await database
    .prepare(
      `SELECT posts.id, posts.thread_id AS threadId, posts.parent_post_id AS parentPostId, posts.author_user_id AS authorUserId, COALESCE(profiles.handle, federation_actors.uri) AS authorHandle, COALESCE(profiles.display_name, federation_actors.name) AS authorName, posts.author_actor_id AS authorActorUri, posts.rendered_html AS renderedHtml, posts.visibility, (SELECT COUNT(*) FROM post_likes WHERE post_likes.post_id = posts.id) AS likeCount, EXISTS(SELECT 1 FROM post_likes WHERE post_likes.post_id = posts.id AND post_likes.actor_id = ?) AS viewerLiked, posts.published_at AS publishedAt, posts.updated_at AS updatedAt FROM posts LEFT JOIN profiles ON profiles.user_id = posts.author_user_id LEFT JOIN federation_actors ON federation_actors.id = posts.author_actor_id WHERE posts.thread_id = ? AND posts.state = 'published' AND (posts.origin = 'local' OR federation_actors.blocked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM user_actor_preferences WHERE user_actor_preferences.user_id = ? AND user_actor_preferences.actor_id = posts.author_actor_id) ${visibility} ORDER BY posts.published_at ASC, posts.id ASC`,
    )
    .bind(viewerActorId, threadId, viewerActorId)
    .all<ForumPost>();
  const blockedDomains = await blockedInstanceDomainsForRemoteUris(
    database,
    posts.results
      .filter((post) => post.authorUserId === null)
      .map((post) => post.authorActorUri),
  );
  return {
    ...posts,
    results: posts.results.filter((post) => {
      if (post.authorUserId !== null || !post.authorActorUri) return true;
      const domain = remoteInstanceDomain(post.authorActorUri);
      return domain === null || !blockedDomains.has(domain);
    }),
  };
}
