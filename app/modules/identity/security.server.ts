import { administratorGroupId } from "@/modules/permissions/system-groups";

import {
  accountStatuses,
  isAccountStatus,
  type AccountStatus,
} from "./account";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  status: AccountStatus;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UserStatusAudit = {
  actorUserId: string;
  targetUserId: string;
  status: AccountStatus;
  reason: string;
};

export function parseAccountStatus(value: string): AccountStatus | null {
  return isAccountStatus(value) ? value : null;
}

export async function listAdminUsers(database: D1Database, query = "") {
  const normalized = query.trim();
  const pattern = `%${normalized.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  return database
    .prepare(
      `SELECT id, name, email, username, status, email_verified AS emailVerified, created_at AS createdAt, updated_at AS updatedAt
       FROM user
       WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\')
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    )
    .bind(normalized, pattern, pattern, pattern)
    .all<AdminUser>();
}

async function administratorCount(database: D1Database) {
  const row = await database
    .prepare(
      "SELECT COUNT(*) AS count FROM group_members WHERE group_id = ? AND user_id IN (SELECT id FROM user WHERE status = 'active')",
    )
    .bind(administratorGroupId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function isAdministrator(database: D1Database, userId: string) {
  return Boolean(
    await database
      .prepare(
        "SELECT 1 AS ok FROM group_members WHERE group_id = ? AND user_id = ? LIMIT 1",
      )
      .bind(administratorGroupId, userId)
      .first(),
  );
}

export async function updateUserStatus(
  database: D1Database,
  input: UserStatusAudit,
) {
  if (!isAccountStatus(input.status)) throw new Error("用户状态无效。");
  const reason = input.reason.trim();
  if (reason.length > 2_000) throw new Error("操作原因不能超过 2,000 个字符。");
  const target = await database
    .prepare("SELECT id, status FROM user WHERE id = ? LIMIT 1")
    .bind(input.targetUserId)
    .first<{ id: string; status: AccountStatus }>();
  if (!target) throw new Error("用户不存在。");

  if (
    input.status !== "active" &&
    (await isAdministrator(database, input.targetUserId)) &&
    (await administratorCount(database)) <= 1
  ) {
    throw new Error("不能停用最后一个活跃管理员。");
  }
  const now = new Date().toISOString();
  const metadata = JSON.stringify({
    from: target.status,
    to: input.status,
    reason,
  });
  const statements = [
    database
      .prepare("UPDATE user SET status = ?, updated_at = ? WHERE id = ?")
      .bind(input.status, now, input.targetUserId),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'user.status', 'user', ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.targetUserId,
        metadata,
        now,
      ),
  ];
  if (input.status !== "active") {
    statements.push(
      database
        .prepare("DELETE FROM session WHERE user_id = ?")
        .bind(input.targetUserId),
    );
  }
  await database.batch(statements);
}

export async function listUserSessions(database: D1Database, userId: string) {
  return database
    .prepare(
      "SELECT id, created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt, ip_address AS ipAddress, user_agent AS userAgent FROM session WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC, id DESC",
    )
    .bind(userId, Math.floor(Date.now() / 1_000))
    .all<{
      id: string;
      createdAt: number;
      updatedAt: number;
      expiresAt: number;
      ipAddress: string | null;
      userAgent: string | null;
    }>();
}

export async function revokeUserSession(
  database: D1Database,
  userId: string,
  sessionId: string,
) {
  return (
    (
      await database
        .prepare("DELETE FROM session WHERE id = ? AND user_id = ?")
        .bind(sessionId, userId)
        .run()
    ).meta.changes > 0
  );
}

export async function revokeAllUserSessions(
  database: D1Database,
  userId: string,
) {
  await database
    .prepare("DELETE FROM session WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function softDeleteUser(
  database: D1Database,
  input: { actorUserId: string; userId: string; reason: string },
) {
  if (
    (await isAdministrator(database, input.userId)) &&
    (await administratorCount(database)) <= 1
  ) {
    throw new Error("不能删除最后一个活跃管理员。");
  }
  const target = await database
    .prepare("SELECT status FROM user WHERE id = ? LIMIT 1")
    .bind(input.userId)
    .first<{ status: AccountStatus }>();
  if (!target) throw new Error("用户不存在。");
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE user SET status = 'deleted', updated_at = ? WHERE id = ?",
      )
      .bind(now, input.userId),
    database
      .prepare("DELETE FROM session WHERE user_id = ?")
      .bind(input.userId),
    database
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'user.delete', 'user', ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        input.actorUserId,
        input.userId,
        JSON.stringify({
          from: target.status,
          reason: input.reason.slice(0, 2_000),
        }),
        now,
      ),
  ]);
}

export { accountStatuses };
