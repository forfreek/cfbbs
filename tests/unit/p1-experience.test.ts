import { describe, expect, it } from "vitest";

import { draftStorageKey } from "@/components/draft-storage";
import {
  decodeBookmarkCursor,
  encodeBookmarkCursor,
} from "@/modules/forum/bookmarks";
import {
  decodeFollowingCursor,
  encodeFollowingCursor,
} from "@/modules/forum/following";
import { extractMentionHandles } from "@/modules/forum/mentions";
import {
  countUnreadNotifications,
  markAllNotificationsRead,
} from "@/modules/forum/notifications/read.server";
import {
  decodeLocalFollowCursor,
  encodeLocalFollowCursor,
} from "@/modules/identity/local-follows";

describe("P1 local experience primitives", () => {
  it("namespaces drafts by user and editor scope", () => {
    expect(draftStorageKey("user-1", "new-thread:board-1")).toBe(
      "cfbbs:draft:v1:user-1:new-thread:board-1",
    );
    expect(draftStorageKey(null, "reply:thread-1")).toBeNull();
  });

  it("extracts unique local mentions without treating URLs as handles", () => {
    expect(
      extractMentionHandles("@Alice hello @alice https://example/@bob @xy"),
    ).toEqual(["alice"]);
  });

  it("round-trips stable cursors", () => {
    const bookmark = {
      createdAt: "2026-08-04T00:00:00.000Z",
      postId: "post-1",
    };
    expect(decodeBookmarkCursor(encodeBookmarkCursor(bookmark))).toEqual(
      bookmark,
    );
    const following = {
      publishedAt: "2026-08-04T00:00:00.000Z",
      itemId: "item-1",
      source: "remote" as const,
    };
    expect(decodeFollowingCursor(encodeFollowingCursor(following))).toEqual(
      following,
    );
    const local = { createdAt: bookmark.createdAt, userId: "user-1" };
    expect(decodeLocalFollowCursor(encodeLocalFollowCursor(local))).toEqual(
      local,
    );
  });

  it("marks all notifications read and counts unread notifications", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ sql, params });
            return {
              run: async () => ({ meta: { changes: 3 } }),
              first: async () => ({ total: 2 }),
              all: async () => ({
                results: [
                  {
                    id: "notification-1",
                    boardId: null,
                    boardVisibility: null,
                    postVisibility: null,
                  },
                  {
                    id: "notification-2",
                    boardId: null,
                    boardVisibility: null,
                    postVisibility: null,
                  },
                ],
              }),
            };
          },
        };
      },
    } as unknown as D1Database;
    await expect(markAllNotificationsRead(database, "user-1")).resolves.toBe(3);
    await expect(countUnreadNotifications(database, "user-1")).resolves.toBe(2);
    expect(calls[0]?.sql).toContain("read_at IS NULL");
  });
});
