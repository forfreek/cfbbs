export type LocalSearchResult = {
  postId: string;
  threadId: string;
  title: string;
  excerpt: string;
  publishedAt: string;
};

export type SearchCursor = { publishedAt: string; postId: string };

export function encodeSearchCursor(cursor: SearchCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeSearchCursor(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    );
    if (!parsed || typeof parsed !== "object") return null;
    const cursor = parsed as Record<string, unknown>;
    if (
      typeof cursor.publishedAt !== "string" ||
      typeof cursor.postId !== "string"
    )
      return null;
    return {
      publishedAt: cursor.publishedAt,
      postId: cursor.postId,
    } satisfies SearchCursor;
  } catch {
    return null;
  }
}

const maximumSearchTerms = 8;

export function localSearchQuery(value: string) {
  const terms = (value.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [])
    .slice(0, maximumSearchTerms)
    .map((term) => `"${term}"`);
  return terms.join(" AND ");
}

export async function searchLocalPostsPage(
  database: D1Database,
  query: string,
  cursor: SearchCursor | null = null,
) {
  const ftsQuery = localSearchQuery(query);
  if (!ftsQuery)
    return { results: [] as LocalSearchResult[], nextCursor: null };
  const cursorClause = cursor
    ? "AND (posts.published_at < ? OR (posts.published_at = ? AND posts.id < ?))"
    : "";
  const sql = `SELECT local_posts_fts.post_id AS postId, local_posts_fts.thread_id AS threadId, threads.title, snippet(local_posts_fts, 3, '', '', '…', 16) AS excerpt, posts.published_at AS publishedAt FROM local_posts_fts INNER JOIN posts ON posts.id = local_posts_fts.post_id INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE local_posts_fts MATCH ? AND posts.origin = 'local' AND posts.state = 'published' AND posts.visibility = 'public' AND boards.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM board_closure AS path INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id WHERE path.descendant_id = boards.id AND ancestor.visibility != 'public') ${cursorClause} ORDER BY rank, posts.published_at DESC, posts.id DESC LIMIT ${cursor ? "?" : "50"}`;
  const params = cursor
    ? [ftsQuery, cursor.publishedAt, cursor.publishedAt, cursor.postId, 51]
    : [ftsQuery];
  const results = await database
    .prepare(sql)
    .bind(...params)
    .all<LocalSearchResult>();
  const page = results.results.slice(0, 50);
  return {
    results: page,
    nextCursor:
      results.results.length > 50 && page.at(-1)
        ? encodeSearchCursor({
            publishedAt: page.at(-1)!.publishedAt,
            postId: page.at(-1)!.postId,
          })
        : null,
  };
}

export async function searchLocalPosts(database: D1Database, query: string) {
  return (await searchLocalPostsPage(database, query)).results;
}
