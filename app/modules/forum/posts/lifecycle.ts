export async function softDeletePost(database: D1Database, postId: string) {
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      "UPDATE posts SET state = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND state != 'deleted'",
    )
    .bind(now, now, postId)
    .run();
  return result.meta.changes > 0;
}
