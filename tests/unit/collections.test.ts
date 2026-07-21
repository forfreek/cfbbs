import { describe, expect, it } from "vitest";

import {
  actorCollectionPage,
  orderedCollection,
  outboxPage,
  publicCollectionQueries,
} from "@/modules/federation/collections";

describe("ActivityPub public collections", () => {
  it("keeps private and non-local posts out of actor outboxes", () => {
    for (const query of [
      publicCollectionQueries.publicActorPostQuery,
      publicCollectionQueries.publicActorPostCountQuery,
    ]) {
      expect(query).toContain("posts.origin = 'local'");
      expect(query).toContain("posts.visibility = 'public'");
      expect(query).toContain("posts.state = 'published'");
      expect(query).toContain("boards.visibility = 'public'");
      expect(query).toContain("ancestor.visibility != 'public'");
    }
  });

  it("returns a stable collection URL and its first page", () => {
    expect(
      orderedCollection("https://bbs.example.test", "alice", "outbox", 2),
    ).toMatchObject({
      id: "https://bbs.example.test/users/alice/outbox",
      type: "OrderedCollection",
      totalItems: 2,
      first: "https://bbs.example.test/users/alice/outbox?page=true",
    });
  });

  it("wraps local posts in public Create activities", () => {
    expect(
      outboxPage("https://bbs.example.test", "alice", [
        {
          id: "post-1",
          authorHandle: "alice",
          html: "<p>Hello</p>",
          publishedAt: "2026-07-19T00:00:00.000Z",
          updatedAt: "2026-07-19T00:00:00.000Z",
          parentPostId: null,
        },
      ]),
    ).toMatchObject({
      type: "OrderedCollectionPage",
      orderedItems: [
        {
          type: "Create",
          object: {
            type: "Note",
            id: "https://bbs.example.test/objects/post-1",
          },
        },
      ],
    });
  });

  it("exposes only accepted follower relationships", () => {
    const followers =
      publicCollectionQueries.actorCollectionQueries("followers");
    const following =
      publicCollectionQueries.actorCollectionQueries("following");
    expect(followers.items).toContain("following_actor_id = ?");
    expect(following.items).toContain("follower_actor_id = ?");
    expect(followers.count).toContain("state = 'accepted'");
    expect(following.count).toContain("state = 'accepted'");
    expect(
      actorCollectionPage("https://bbs.example.test", "alice", "followers", [
        "https://remote.example/users/bob",
      ]),
    ).toMatchObject({
      orderedItems: ["https://remote.example/users/bob"],
    });
  });

  it("looks up collection owners with an explicit local-actor predicate", () => {
    expect(publicCollectionQueries.localActorCollectionOwnerQuery).toContain(
      "federation_actors.is_local = 1",
    );
    expect(publicCollectionQueries.localActorCollectionOwnerQuery).toContain(
      "profiles.handle = ?",
    );
  });
});
