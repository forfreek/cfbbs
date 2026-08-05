import { isSafeQuoteUri } from "./p2";

export type QuoteInput = {
  targetPostId: string | null;
  targetUri: string;
  snapshotHtml: string | null;
  snapshotTitle: string | null;
};

export async function resolveQuoteTarget(
  database: D1Database,
  input: {
    targetPostId?: string | null;
    targetUri: string;
  },
): Promise<{ ok: true; quote: QuoteInput } | { ok: false; message: string }> {
  if (!isSafeQuoteUri(input.targetUri)) {
    return { ok: false, message: "引用地址必须是安全 HTTPS 地址。" };
  }
  const targetPostId = input.targetPostId?.trim() || null;
  if (!targetPostId) {
    return {
      ok: true,
      quote: {
        targetPostId: null,
        targetUri: input.targetUri,
        snapshotHtml: null,
        snapshotTitle: null,
      },
    };
  }
  const target = await database
    .prepare(
      `SELECT posts.id, posts.federation_object_id AS objectUri,
              posts.rendered_html AS renderedHtml, threads.title AS threadTitle
       FROM posts
       INNER JOIN threads ON threads.id = posts.thread_id
       INNER JOIN boards ON boards.id = threads.board_id
       LEFT JOIN federation_actors ON federation_actors.id = posts.author_actor_id
       WHERE posts.id = ? AND posts.state = 'published'
         AND posts.visibility = 'public' AND boards.visibility = 'public'
         AND posts.federation_object_id = ?
         AND (posts.origin = 'local' OR federation_actors.blocked_at IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM board_closure AS path
           INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id
           WHERE path.descendant_id = boards.id AND ancestor.visibility != 'public'
         )
       LIMIT 1`,
    )
    .bind(targetPostId, input.targetUri)
    .first<{
      id: string;
      objectUri: string;
      renderedHtml: string;
      threadTitle: string;
    }>();
  if (!target) {
    return { ok: false, message: "只能引用当前可见的公开帖子。" };
  }
  return {
    ok: true,
    quote: {
      targetPostId: target.id,
      targetUri: target.objectUri,
      snapshotHtml: target.renderedHtml,
      snapshotTitle: target.threadTitle,
    },
  };
}
