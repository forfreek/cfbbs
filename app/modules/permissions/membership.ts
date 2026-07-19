export async function addGroupMember(
  database: D1Database,
  groupId: string,
  userId: string,
) {
  await database
    .prepare(
      "INSERT OR IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(groupId, userId, new Date().toISOString())
    .run();
}

export async function removeGroupMember(
  database: D1Database,
  groupId: string,
  userId: string,
) {
  await database
    .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
    .bind(groupId, userId)
    .run();
}
