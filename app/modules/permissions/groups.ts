import type { Permission } from "./authorization";
import { administratorGroupId } from "./system-groups";

const permissionKeys = [
  "site.manage",
  "users.manage",
  "groups.manage",
  "federation.manage",
  "boards.manage",
  "boards.view",
  "threads.create",
  "posts.reply",
  "posts.edit_any",
  "posts.delete_any",
  "threads.pin",
  "threads.lock",
  "reports.manage",
  "audit.view",
] as const satisfies readonly Permission[];

export type ManagedGroup = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
};

export type GroupGrant = {
  groupId: string;
  permission: Permission;
  boardId: string | null;
  createdAt: string;
};

type GroupRecord = { id: string; isSystem: number };
type CountRecord = { count: number };

type GroupAudit = { actorUserId: string; auditId: string };

function assertAudit(input: GroupAudit) {
  if (!input.actorUserId.trim() || !input.auditId.trim()) {
    throw new Error(
      "Group changes require an administrator and audit identifier.",
    );
  }
}

function groupAuditStatement(
  database: D1Database,
  audit: GroupAudit,
  action: string,
  groupId: string,
  metadata: Record<string, unknown>,
  now: string,
) {
  return database
    .prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata, created_at) VALUES (?, ?, ?, 'group', ?, ?, ?)",
    )
    .bind(
      audit.auditId,
      audit.actorUserId,
      action,
      groupId,
      JSON.stringify(metadata),
      now,
    );
}

async function loadGroup(database: D1Database, groupId: string) {
  return database
    .prepare(
      "SELECT id, is_system AS isSystem FROM groups WHERE id = ? LIMIT 1",
    )
    .bind(groupId)
    .first<GroupRecord>();
}

function normalizeGroupDetails(input: { name: string; description: string }) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || name.length > 80) {
    throw new Error("Group name must be between 1 and 80 characters.");
  }
  if (description.length > 2_000) {
    throw new Error("Group description must be 2,000 characters or fewer.");
  }
  return { name, description };
}

export function isPermission(value: string): value is Permission {
  return (permissionKeys as readonly string[]).includes(value);
}

export async function listGroups(database: D1Database) {
  return database
    .prepare(
      "SELECT groups.id, groups.name, groups.description, groups.is_system AS isSystem, groups.created_at AS createdAt, groups.updated_at AS updatedAt, COUNT(group_members.user_id) AS memberCount FROM groups LEFT JOIN group_members ON group_members.group_id = groups.id GROUP BY groups.id ORDER BY groups.is_system DESC, groups.name ASC",
    )
    .all<ManagedGroup>();
}

export async function listGroupPermissions(
  database: D1Database,
  groupId: string,
) {
  return database
    .prepare(
      "SELECT group_id AS groupId, permission_key AS permission, board_id AS boardId, created_at AS createdAt FROM group_permissions WHERE group_id = ? ORDER BY permission_key ASC, board_id ASC",
    )
    .bind(groupId)
    .all<GroupGrant>();
}

export async function createGroup(
  database: D1Database,
  input: GroupAudit & { id: string; name: string; description: string },
) {
  assertAudit(input);
  if (!input.id.trim()) throw new Error("A group identifier is required.");
  const details = normalizeGroupDetails(input);
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT INTO groups (id, name, description, is_system, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
      )
      .bind(input.id, details.name, details.description, now, now),
    groupAuditStatement(
      database,
      input,
      "group.create",
      input.id,
      details,
      now,
    ),
  ]);
}

export async function updateGroup(
  database: D1Database,
  input: GroupAudit & { groupId: string; name: string; description: string },
) {
  assertAudit(input);
  const group = await loadGroup(database, input.groupId);
  if (!group) throw new Error("Group does not exist.");
  if (group.isSystem)
    throw new Error("System group details cannot be changed.");
  const details = normalizeGroupDetails(input);
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "UPDATE groups SET name = ?, description = ?, updated_at = ? WHERE id = ?",
      )
      .bind(details.name, details.description, now, input.groupId),
    groupAuditStatement(
      database,
      input,
      "group.update",
      input.groupId,
      details,
      now,
    ),
  ]);
}

export async function deleteGroup(
  database: D1Database,
  input: GroupAudit & { groupId: string },
) {
  assertAudit(input);
  const group = await loadGroup(database, input.groupId);
  if (!group) return false;
  if (group.isSystem) throw new Error("System groups cannot be deleted.");
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("DELETE FROM group_permissions WHERE group_id = ?")
      .bind(input.groupId),
    database
      .prepare("DELETE FROM group_members WHERE group_id = ?")
      .bind(input.groupId),
    database.prepare("DELETE FROM groups WHERE id = ?").bind(input.groupId),
    groupAuditStatement(
      database,
      input,
      "group.delete",
      input.groupId,
      {},
      now,
    ),
  ]);
  return true;
}

export async function setGroupPermission(
  database: D1Database,
  input: GroupAudit & {
    groupId: string;
    permission: Permission;
    boardId: string | null;
  },
) {
  assertAudit(input);
  if (!isPermission(input.permission)) throw new Error("Unknown permission.");
  if (!(await loadGroup(database, input.groupId))) {
    throw new Error("Group does not exist.");
  }
  if (input.boardId) {
    const board = await database
      .prepare("SELECT id FROM boards WHERE id = ? LIMIT 1")
      .bind(input.boardId)
      .first<{ id: string }>();
    if (!board) throw new Error("Board does not exist.");
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "DELETE FROM group_permissions WHERE group_id = ? AND permission_key = ? AND board_id IS ?",
      )
      .bind(input.groupId, input.permission, input.boardId),
    database
      .prepare(
        "INSERT INTO group_permissions (group_id, permission_key, board_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(input.groupId, input.permission, input.boardId, now),
    groupAuditStatement(
      database,
      input,
      "group.permission.set",
      input.groupId,
      {
        permission: input.permission,
        boardId: input.boardId,
      },
      now,
    ),
  ]);
}

export async function removeGroupPermission(
  database: D1Database,
  input: GroupAudit & {
    groupId: string;
    permission: Permission;
    boardId: string | null;
  },
) {
  assertAudit(input);
  if (!isPermission(input.permission)) throw new Error("Unknown permission.");
  if (!(await loadGroup(database, input.groupId))) {
    throw new Error("Group does not exist.");
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "DELETE FROM group_permissions WHERE group_id = ? AND permission_key = ? AND board_id IS ?",
      )
      .bind(input.groupId, input.permission, input.boardId),
    groupAuditStatement(
      database,
      input,
      "group.permission.remove",
      input.groupId,
      {
        permission: input.permission,
        boardId: input.boardId,
      },
      now,
    ),
  ]);
}

export async function addManagedGroupMember(
  database: D1Database,
  input: GroupAudit & { groupId: string; userId: string },
) {
  assertAudit(input);
  if (!input.userId.trim()) throw new Error("A user identifier is required.");
  if (!(await loadGroup(database, input.groupId))) {
    throw new Error("Group does not exist.");
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(
        "INSERT OR IGNORE INTO group_members (group_id, user_id, created_at) VALUES (?, ?, ?)",
      )
      .bind(input.groupId, input.userId, now),
    groupAuditStatement(
      database,
      input,
      "group.member.add",
      input.groupId,
      {
        userId: input.userId,
      },
      now,
    ),
  ]);
}

export async function removeManagedGroupMember(
  database: D1Database,
  input: GroupAudit & { groupId: string; userId: string },
) {
  assertAudit(input);
  if (!input.userId.trim()) throw new Error("A user identifier is required.");
  const group = await loadGroup(database, input.groupId);
  if (!group) throw new Error("Group does not exist.");
  if (input.groupId === administratorGroupId) {
    const members = await database
      .prepare("SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?")
      .bind(input.groupId)
      .first<CountRecord>();
    if ((members?.count ?? 0) <= 1) {
      throw new Error("The last administrator cannot be removed.");
    }
  }
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?")
      .bind(input.groupId, input.userId),
    groupAuditStatement(
      database,
      input,
      "group.member.remove",
      input.groupId,
      {
        userId: input.userId,
      },
      now,
    ),
  ]);
}
