import { describe, expect, it } from "vitest";

import {
  setBoardSortOrder,
  setBoardVisibility,
} from "@/modules/forum/boards/service";

function serviceDatabase(options: {
  board?: {
    id: string;
    parentId: string | null;
    visibility: "public" | "private";
  };
  hasPrivateParent?: boolean;
  hasPublicPost?: boolean;
}) {
  const batches: Array<Array<{ sql: string; values: unknown[] }>> = [];
  return {
    database: {
      prepare(sql: string) {
        const values: unknown[] = [];
        return {
          bind(...bound: unknown[]) {
            values.push(...bound);
            if (sql.startsWith("SELECT id, parent_id")) {
              return { first: async () => options.board ?? null };
            }
            if (sql.includes("SELECT 1 AS privateAncestor")) {
              return {
                first: async () =>
                  options.hasPrivateParent ? { privateAncestor: 1 } : null,
              };
            }
            if (sql.includes("SELECT 1 AS publicPost")) {
              return {
                first: async () =>
                  options.hasPublicPost ? { publicPost: 1 } : null,
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

describe("board management service", () => {
  it("rejects a non-integral sort order", async () => {
    const { database } = serviceDatabase({});

    await expect(
      setBoardSortOrder(database, {
        ...audit,
        boardId: "board-1",
        sortOrder: 1.5,
      }),
    ).rejects.toThrow("integer");
  });

  it("rejects making a board private after public posts exist", async () => {
    const { database, batches } = serviceDatabase({
      board: { id: "board-1", parentId: null, visibility: "public" },
      hasPublicPost: true,
    });

    await expect(
      setBoardVisibility(database, {
        ...audit,
        boardId: "board-1",
        visibility: "private",
      }),
    ).rejects.toThrow("public posts");
    expect(batches).toEqual([]);
  });

  it("cascades an empty board's private visibility to its descendants", async () => {
    const { database, batches } = serviceDatabase({
      board: { id: "board-1", parentId: null, visibility: "public" },
    });

    await expect(
      setBoardVisibility(database, {
        ...audit,
        boardId: "board-1",
        visibility: "private",
      }),
    ).resolves.toBe(true);
    expect(batches[0][0].sql).toContain("SELECT descendant_id");
    expect(batches[0][1].sql).toContain("audit_logs");
  });

  it("prevents exposing a board beneath a private parent", async () => {
    const { database } = serviceDatabase({
      board: {
        id: "board-1",
        parentId: "private-parent",
        visibility: "private",
      },
      hasPrivateParent: true,
    });

    await expect(
      setBoardVisibility(database, {
        ...audit,
        boardId: "board-1",
        visibility: "public",
      }),
    ).rejects.toThrow("private parent");
  });
});
