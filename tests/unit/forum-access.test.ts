import { describe, expect, it } from "vitest";

import {
  canViewForumBoard,
  isForumBoardWithinPrivateTree,
} from "@/modules/forum/access.server";

function accessDatabase(options: {
  hasPrivateAncestor: boolean;
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
            if (sql.includes("FROM board_closure AS path")) {
              return {
                first: async () =>
                  options.hasPrivateAncestor ? { privateAncestor: 1 } : null,
              };
            }
            if (sql.includes("FROM group_permissions")) {
              return { all: async () => ({ results: options.grants ?? [] }) };
            }
            if (sql.startsWith("SELECT group_id")) {
              return {
                all: async () => ({
                  results: (options.groupIds ?? []).map((groupId) => ({
                    groupId,
                  })),
                }),
              };
            }
            return {
              all: async () => ({
                results: (options.ancestorIds ?? ["board-1"]).map(
                  (ancestorId) => ({ ancestorId }),
                ),
              }),
            };
          },
        };
      },
    } as unknown as D1Database,
    queries,
  };
}

const publicChild = {
  id: "board-1",
  parentId: "private-parent",
  slug: "child",
  title: "Child",
  description: "",
  mode: "posting" as const,
  visibility: "public" as const,
};

describe("forum board ancestor privacy", () => {
  it("recognizes a private ancestor through the closure table", async () => {
    const { database, queries } = accessDatabase({ hasPrivateAncestor: true });

    await expect(
      isForumBoardWithinPrivateTree(database, "board-1"),
    ).resolves.toBe(true);
    expect(queries[0]).toContain("board_closure AS path");
    expect(queries[0]).toContain("ancestor.visibility = 'private'");
  });

  it("does not expose a public child that sits below a private ancestor", async () => {
    const { database } = accessDatabase({ hasPrivateAncestor: true });

    await expect(canViewForumBoard(database, publicChild, null)).resolves.toBe(
      false,
    );
  });

  it("allows a viewer with inherited private-board access", async () => {
    const { database } = accessDatabase({
      hasPrivateAncestor: true,
      groupIds: ["staff"],
      grants: [
        {
          groupId: "staff",
          permission: "boards.view",
          boardId: "private-parent",
        },
      ],
      ancestorIds: ["board-1", "private-parent"],
    });

    await expect(
      canViewForumBoard(database, publicChild, "user-1"),
    ).resolves.toBe(true);
  });
});
