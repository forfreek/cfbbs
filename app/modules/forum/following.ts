export type FollowingCursor = {
  publishedAt: string;
  itemId: string;
  source: "local" | "remote";
};

export type FollowingFeedItem = {
  source: "local" | "remote";
  itemId: string;
  publishedAt: string;
  updatedAt: string | null;
  actorId: string;
  actorUri: string | null;
  actorHandle: string | null;
  actorName: string;
  contentHtml: string;
  threadId: string | null;
  postId: string | null;
  objectUri: string;
};

export function encodeFollowingCursor(cursor: FollowingCursor) {
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function decodeFollowingCursor(value: string | null) {
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
      typeof cursor.itemId !== "string" ||
      (cursor.source !== "local" && cursor.source !== "remote")
    ) {
      return null;
    }
    return {
      publishedAt: cursor.publishedAt,
      itemId: cursor.itemId,
      source: cursor.source,
    } satisfies FollowingCursor;
  } catch {
    return null;
  }
}

export async function listFollowingFeed(
  database: D1Database,
  userId: string,
  cursor: FollowingCursor | null = null,
) {
  const predicate = cursor
    ? "WHERE (publishedAt < ? OR (publishedAt = ? AND (itemId < ? OR (itemId = ? AND source < ?))))"
    : "";
  const params = cursor
    ? [
        userId,
        userId,
        userId,
        userId,
        cursor.publishedAt,
        cursor.publishedAt,
        cursor.itemId,
        cursor.itemId,
        cursor.source,
        51,
      ]
    : [userId, userId, userId, userId, 51];
  const rows = await database
    .prepare(
      `WITH feed AS (
        SELECT 'local' AS source,
               posts.id AS itemId,
               posts.published_at AS publishedAt,
               posts.updated_at AS updatedAt,
               profiles.user_id AS actorId,
               NULL AS actorUri,
               profiles.handle AS actorHandle,
               profiles.display_name AS actorName,
               posts.rendered_html AS contentHtml,
               posts.thread_id AS threadId,
               posts.id AS postId,
               posts.federation_object_id AS objectUri
        FROM local_follows
        INNER JOIN posts ON posts.author_user_id = local_follows.following_user_id
        INNER JOIN profiles ON profiles.user_id = posts.author_user_id
        WHERE local_follows.follower_user_id = ?
          AND posts.origin = 'local' AND posts.visibility = 'public' AND posts.state = 'published'
        UNION ALL
        SELECT 'remote' AS source,
               federation_objects.uri AS itemId,
               federation_objects.published_at AS publishedAt,
               COALESCE(federation_objects.updated_at, federation_objects.published_at) AS updatedAt,
               federation_actors.id AS actorId,
               federation_actors.uri AS actorUri,
               federation_actors.handle AS actorHandle,
               federation_actors.name AS actorName,
               federation_objects.content_html AS contentHtml,
               NULL AS threadId,
               NULL AS postId,
               federation_objects.uri AS objectUri
        FROM federation_follows
        INNER JOIN federation_actors ON federation_actors.id = federation_follows.following_actor_id
        INNER JOIN federation_objects ON federation_objects.actor_id = federation_actors.id
        WHERE federation_follows.follower_actor_id = ?
          AND federation_follows.state = 'accepted'
          AND federation_objects.type = 'Note' AND federation_objects.deleted_at IS NULL
        UNION ALL
        SELECT 'local' AS source,
               'boost:' || post_boosts.id AS itemId,
               post_boosts.created_at AS publishedAt,
               post_boosts.created_at AS updatedAt,
               booster.id AS actorId,
               NULL AS actorUri,
               booster_profile.handle AS actorHandle,
               booster_profile.display_name AS actorName,
               boosted.rendered_html AS contentHtml,
               boosted.thread_id AS threadId,
               boosted.id AS postId,
               boosted.federation_object_id AS objectUri
        FROM post_boosts
        INNER JOIN user AS booster ON booster.id = post_boosts.actor_id
        INNER JOIN profiles AS booster_profile ON booster_profile.user_id = booster.id
        INNER JOIN posts AS boosted ON boosted.id = post_boosts.post_id
        INNER JOIN threads AS boosted_thread ON boosted_thread.id = boosted.thread_id
        INNER JOIN boards AS boosted_board ON boosted_board.id = boosted_thread.board_id
        INNER JOIN local_follows ON local_follows.following_user_id = booster.id
        WHERE local_follows.follower_user_id = ?
          AND post_boosts.revoked_at IS NULL
          AND boosted.visibility = 'public' AND boosted.state = 'published' AND boosted_board.visibility = 'public'
        UNION ALL
        SELECT 'remote' AS source,
               'boost:' || post_boosts.id AS itemId,
               post_boosts.created_at AS publishedAt,
               post_boosts.created_at AS updatedAt,
               boost_actor.id AS actorId,
               boost_actor.uri AS actorUri,
               boost_actor.handle AS actorHandle,
               boost_actor.name AS actorName,
               boosted.rendered_html AS contentHtml,
               boosted.thread_id AS threadId,
               boosted.id AS postId,
               boosted.federation_object_id AS objectUri
        FROM post_boosts
        INNER JOIN federation_actors AS boost_actor ON boost_actor.uri = post_boosts.actor_id AND boost_actor.is_local = 0
        INNER JOIN federation_follows AS boost_follow ON boost_follow.following_actor_id = boost_actor.id AND boost_follow.state = 'accepted'
        INNER JOIN posts AS boosted ON boosted.id = post_boosts.post_id
        INNER JOIN threads AS boosted_thread ON boosted_thread.id = boosted.thread_id
        INNER JOIN boards AS boosted_board ON boosted_board.id = boosted_thread.board_id
        WHERE boost_follow.follower_actor_id = ?
          AND post_boosts.revoked_at IS NULL
          AND boosted.visibility = 'public' AND boosted.state = 'published' AND boosted_board.visibility = 'public'
      )
      SELECT * FROM feed ${predicate}
      ORDER BY publishedAt DESC, itemId DESC, source DESC
      LIMIT ?`,
    )
    .bind(...params)
    .all<FollowingFeedItem>();
  const results = rows.results.slice(0, 50);
  const last = results.at(-1);
  return {
    results,
    nextCursor:
      rows.results.length > 50 && last
        ? encodeFollowingCursor({
            publishedAt: last.publishedAt,
            itemId: last.itemId,
            source: last.source,
          })
        : null,
  };
}
