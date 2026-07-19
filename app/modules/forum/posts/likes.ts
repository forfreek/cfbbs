export function nextLikeState(
  existingActorIds: ReadonlySet<string>,
  actorId: string,
) {
  const actorIds = new Set(existingActorIds);
  if (actorIds.has(actorId)) {
    actorIds.delete(actorId);
    return { actorIds, action: "removed" as const };
  }
  actorIds.add(actorId);
  return { actorIds, action: "added" as const };
}

export async function togglePostLike(
  database: D1Database,
  postId: string,
  actorId: string,
) {
  const inserted = await database
    .prepare(
      "INSERT OR IGNORE INTO post_likes (post_id, actor_id, activity_id, created_at) VALUES (?, ?, NULL, ?)",
    )
    .bind(postId, actorId, new Date().toISOString())
    .run();
  if (inserted.meta.changes > 0) return "added" as const;

  await database
    .prepare("DELETE FROM post_likes WHERE post_id = ? AND actor_id = ?")
    .bind(postId, actorId)
    .run();
  return "removed" as const;
}
