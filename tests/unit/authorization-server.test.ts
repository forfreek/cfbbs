import { describe, expect, it } from "vitest";

import { authorizeDatabase } from "@/modules/permissions/authorization.server";

function authorizationDatabase({
  groupIds = [],
  grants = [],
  ancestorIds = [],
}: {
  groupIds?: string[];
  grants?: Array<{
    groupId: string;
    permission: string;
    boardId: string | null;
  }>;
  ancestorIds?: string[];
}) {
  const queries: string[] = [];
  return {
    database: {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind() {
            if (sql.includes("FROM group_permissions")) {
              return { all: async () => ({ results: grants }) };
            }
            if (sql.startsWith("SELECT group_id")) {
              return {
                all: async () => ({
                  results: groupIds.map((groupId) => ({ groupId })),
                }),
              };
            }
            return {
              all: async () => ({
                results: ancestorIds.map((ancestorId) => ({ ancestorId })),
              }),
            };
          },
        };
      },
    } as unknown as D1Database,
    queries,
  };
}

describe("D1-backed authorization", () => {
  it("does not query D1 for anonymous requests", async () => {
    const { database, queries } = authorizationDatabase({});

    await expect(
      authorizeDatabase(database, {
        userId: null,
        permission: "threads.create",
      }),
    ).resolves.toEqual({ allowed: false, reason: "anonymous" });
    expect(queries).toEqual([]);
  });

  it("loads group grants and closure ancestors before evaluating access", async () => {
    const { database, queries } = authorizationDatabase({
      groupIds: ["members"],
      grants: [
        { groupId: "members", permission: "threads.create", boardId: "parent" },
      ],
      ancestorIds: ["child", "parent"],
    });

    await expect(
      authorizeDatabase(database, {
        userId: "user-1",
        permission: "threads.create",
        boardId: "child",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "granted" });
    expect(queries).toHaveLength(3);
    expect(queries[1]).toContain("group_id IN (?)");
    expect(queries[2]).toContain("board_closure");
  });
});
