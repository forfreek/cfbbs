import { describe, expect, it } from "vitest";

import {
  localSearchQuery,
  searchLocalPosts,
} from "@/modules/forum/search/service";

describe("local FTS search", () => {
  it("normalizes free-form input into a bounded literal FTS query", () => {
    expect(localSearchQuery('  hello OR "world"  ')).toBe(
      '"hello" AND "OR" AND "world"',
    );
    expect(localSearchQuery("    ")).toBe("");
    expect(localSearchQuery("一 二 三 四 五 六 七 八 九")).toBe(
      '"一" AND "二" AND "三" AND "四" AND "五" AND "六" AND "七" AND "八"',
    );
  });

  it("queries only still-public local content under public board ancestors", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      searchLocalPosts(database, "federation notes"),
    ).resolves.toEqual([]);
    expect(statements[0]?.sql).toContain("local_posts_fts MATCH ?");
    expect(statements[0]?.sql).toContain("posts.origin = 'local'");
    expect(statements[0]?.sql).toContain("posts.visibility = 'public'");
    expect(statements[0]?.sql).toContain("ancestor.visibility != 'public'");
    expect(statements[0]?.params).toEqual(['"federation" AND "notes"']);
  });

  it("does not query FTS for an empty input", async () => {
    const database = {
      prepare() {
        throw new Error("FTS should not run");
      },
    } as unknown as D1Database;

    await expect(searchLocalPosts(database, " ")).resolves.toEqual([]);
  });
});
