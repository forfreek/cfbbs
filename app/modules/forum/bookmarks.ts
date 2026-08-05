export type BookmarkCursor = { createdAt: string; postId: string };

export type PostBookmark = {
  postId: string;
  threadId: string;
  threadTitle: string;
  boardId: string;
  boardTitle: string;
  boardVisibility: "public" | "private";
  postVisibility: "public" | "private";
  renderedHtml: string;
  authorHandle: string | null;
  authorName: string | null;
  createdAt: string;
};

export function encodeBookmarkCursor(cursor: BookmarkCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeBookmarkCursor(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.createdAt !== "string" ||
      typeof cursor.postId !== "string" ||
      cursor.createdAt.length === 0 ||
      cursor.postId.length === 0
    ) {
      return null;
    }
    return { createdAt: cursor.createdAt, postId: cursor.postId };
  } catch {
    return null;
  }
}

export async function isPostBookmarked(
  database: D1Database,
  userId: string,
  postId: string,
) {
  const row = await database
    .prepare(
      "SELECT 1 AS present FROM post_bookmarks WHERE user_id = ? AND post_id = ? LIMIT 1",
    )
    .bind(userId, postId)
    .first<{ present: number }>();
  return row !== null;
}

export async function setPostBookmark(
  database: D1Database,
  input: { userId: string; postId: string; bookmarked: boolean },
) {
  const post = await database
    .prepare(
      "SELECT posts.id, posts.state, posts.visibility FROM posts WHERE posts.id = ? LIMIT 1",
    )
    .bind(input.postId)
    .first<{ id: string; state: string; visibility: string }>();
  if (!post || post.state === "deleted") {
    return { ok: false as const, message: "帖子不存在。" };
  }
  if (post.visibility !== "public" && post.visibility !== "private") {
    return { ok: false as const, message: "帖子不可收藏。" };
  }
  if (input.bookmarked) {
    await database
      .prepare(
        "INSERT OR IGNORE INTO post_bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)",
      )
      .bind(input.userId, input.postId, new Date().toISOString())
      .run();
  } else {
    await database.batch([
      database
        .prepare("DELETE FROM post_bookmarks WHERE user_id = ? AND post_id = ?")
        .bind(input.userId, input.postId),
      database
        .prepare(
          "DELETE FROM bookmark_folder_items WHERE user_id = ? AND post_id = ?",
        )
        .bind(input.userId, input.postId),
    ]);
  }
  return { ok: true as const, bookmarked: input.bookmarked };
}

export async function listPostBookmarks(
  database: D1Database,
  userId: string,
  cursor: BookmarkCursor | null = null,
  folderId: string | null = null,
) {
  const folderPredicate = folderId
    ? "AND EXISTS (SELECT 1 FROM bookmark_folder_items WHERE bookmark_folder_items.folder_id = ? AND bookmark_folder_items.post_id = post_bookmarks.post_id AND bookmark_folder_items.user_id = ?)"
    : "";
  const predicate = cursor
    ? "AND (post_bookmarks.created_at < ? OR (post_bookmarks.created_at = ? AND post_bookmarks.post_id < ?))"
    : "";
  const params = cursor
    ? [
        userId,
        ...(folderId ? [folderId, userId] : []),
        cursor.createdAt,
        cursor.createdAt,
        cursor.postId,
        51,
      ]
    : [userId, ...(folderId ? [folderId, userId] : []), 51];
  const rows = await database
    .prepare(
      `SELECT post_bookmarks.post_id AS postId,
              posts.thread_id AS threadId,
              threads.title AS threadTitle,
              threads.board_id AS boardId,
              boards.title AS boardTitle,
              boards.visibility AS boardVisibility,
              posts.visibility AS postVisibility,
              posts.rendered_html AS renderedHtml,
              profiles.handle AS authorHandle,
              profiles.display_name AS authorName,
              post_bookmarks.created_at AS createdAt
       FROM post_bookmarks
       INNER JOIN posts ON posts.id = post_bookmarks.post_id
       INNER JOIN threads ON threads.id = posts.thread_id
       INNER JOIN boards ON boards.id = threads.board_id
       LEFT JOIN profiles ON profiles.user_id = posts.author_user_id
       WHERE post_bookmarks.user_id = ?
         AND posts.state = 'published'
         ${folderPredicate}
         ${predicate}
       ORDER BY post_bookmarks.created_at DESC, post_bookmarks.post_id DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all<PostBookmark>();
  const results = rows.results.slice(0, 50);
  const last = results.at(-1);
  return {
    results,
    nextCursor:
      rows.results.length > 50 && last
        ? encodeBookmarkCursor({
            createdAt: last.createdAt,
            postId: last.postId,
          })
        : null,
  };
}
