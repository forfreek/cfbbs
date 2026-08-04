import { describe, expect, it } from "vitest";

import {
  decodeForumPostCursor,
  encodeForumPostCursor,
} from "@/modules/forum/read.server";
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
} from "@/modules/forum/notifications/read.server";
import {
  decodeSearchCursor,
  encodeSearchCursor,
} from "@/modules/forum/search/service";
import {
  decodeHomeCursor,
  encodeHomeCursor,
} from "@/modules/forum/home/service";

describe("cursor pagination", () => {
  it("round-trips all public feed cursor shapes and rejects tampering", () => {
    expect(
      decodeHomeCursor(
        encodeHomeCursor({
          sort: "active",
          activityAt: "2026-08-04T00:00:00.000Z",
          id: "thread-1",
          replyCount: 4,
        }),
        "active",
      ),
    ).toEqual({
      sort: "active",
      activityAt: "2026-08-04T00:00:00.000Z",
      id: "thread-1",
      replyCount: 4,
    });
    expect(decodeHomeCursor("bad", "active")).toBeNull();
    expect(
      decodeForumPostCursor(
        encodeForumPostCursor({ publishedAt: "2026-08-04", id: "post-1" }),
      ),
    ).toEqual({ publishedAt: "2026-08-04", id: "post-1" });
    expect(
      decodeNotificationCursor(
        encodeNotificationCursor({ createdAt: "2026-08-04", id: "notice-1" }),
      ),
    ).toEqual({ createdAt: "2026-08-04", id: "notice-1" });
    expect(
      decodeSearchCursor(
        encodeSearchCursor({ publishedAt: "2026-08-04", postId: "post-1" }),
      ),
    ).toEqual({ publishedAt: "2026-08-04", postId: "post-1" });
  });
});
