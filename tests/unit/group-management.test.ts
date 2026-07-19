import { describe, expect, it } from "vitest";

import {
  addManagedGroupMember,
  isPermission,
  removeManagedGroupMember,
  setGroupPermission,
} from "@/modules/permissions/groups";
import { administratorGroupId } from "@/modules/permissions/system-groups";

function groupDatabase(options: {
  group?: { id: string; isSystem: number };
  boardExists?: boolean;
  userExists?: boolean;
  memberCount?: number;
}) {
  const batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
  return {
    database: {
      prepare(sql: string) {
        const values: unknown[] = [];
        return {
          bind(...bound: unknown[]) {
            values.push(...bound);
            if (sql.startsWith("SELECT id, is_system")) {
              return { first: async () => options.group ?? null };
            }
            if (sql.startsWith("SELECT id FROM boards")) {
              return {
                first: async () =>
                  options.boardExists ? { id: "board-1" } : null,
              };
            }
            if (sql.startsWith("SELECT id FROM user")) {
              return {
                first: async () =>
                  options.userExists ? { id: "user-1" } : null,
              };
            }
            if (sql.startsWith("SELECT COUNT(*)")) {
              return {
                first: async () => ({ count: options.memberCount ?? 0 }),
              };
            }
            return { sql, values };
          },
        };
      },
      async batch(statements: Array<{ sql: string; values: unknown[] }>) {
        batches.push(statements);
      },
    } as unknown as D1Database,
    batches,
  };
}

const audit = { actorUserId: "admin-1", auditId: "audit-1" };

describe("group management", () => {
  it("allows only declared permission keys", () => {
    expect(isPermission("boards.view")).toBe(true);
    expect(isPermission("users.destroy")).toBe(false);
  });

  it("replaces a global grant before inserting it, including NULL board scope", async () => {
    const { database, batches } = groupDatabase({
      group: { id: "group-1", isSystem: 0 },
    });

    await setGroupPermission(database, {
      ...audit,
      groupId: "group-1",
      permission: "boards.view",
      boardId: null,
    });

    expect(batches[0][0].sql).toContain("board_id IS ?");
    expect(batches[0][0].values).toEqual(["group-1", "boards.view", null]);
    expect(batches[0][1].sql).toContain("INSERT INTO group_permissions");
    expect(batches[0][2].sql).toContain("audit_logs");
  });

  it("preserves at least one administrator membership", async () => {
    const { database, batches } = groupDatabase({
      group: { id: administratorGroupId, isSystem: 1 },
      memberCount: 1,
    });

    await expect(
      removeManagedGroupMember(database, {
        ...audit,
        groupId: administratorGroupId,
        userId: "admin-1",
      }),
    ).rejects.toThrow("last administrator");
    expect(batches).toEqual([]);
  });

  it("does not assign a group to an unknown user", async () => {
    const { database, batches } = groupDatabase({
      group: { id: "group-1", isSystem: 0 },
    });

    await expect(
      addManagedGroupMember(database, {
        ...audit,
        groupId: "group-1",
        userId: "missing-user",
      }),
    ).rejects.toThrow("User does not exist");
    expect(batches).toEqual([]);
  });
});
