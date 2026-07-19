export type LocalSearchResult = {
  postId: string;
  threadId: string;
  title: string;
  excerpt: string;
  publishedAt: string;
};

const maximumSearchTerms = 8;

export function localSearchQuery(value: string) {
  const terms = (value.normalize("NFKC").match(/[\p{L}\p{N}_]+/gu) ?? [])
    .slice(0, maximumSearchTerms)
    .map((term) => `"${term}"`);
  return terms.join(" AND ");
}

export async function searchLocalPosts(database: D1Database, query: string) {
  const ftsQuery = localSearchQuery(query);
  if (!ftsQuery) return [] as LocalSearchResult[];
  const results = await database
    .prepare(
      "SELECT local_posts_fts.post_id AS postId, local_posts_fts.thread_id AS threadId, threads.title, snippet(local_posts_fts, 3, '', '', '…', 16) AS excerpt, posts.published_at AS publishedAt FROM local_posts_fts INNER JOIN posts ON posts.id = local_posts_fts.post_id INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE local_posts_fts MATCH ? AND posts.origin = 'local' AND posts.state = 'published' AND posts.visibility = 'public' AND boards.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM board_closure AS path INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id WHERE path.descendant_id = boards.id AND ancestor.visibility != 'public') ORDER BY rank LIMIT 50",
    )
    .bind(ftsQuery)
    .all<LocalSearchResult>();
  return results.results;
}
