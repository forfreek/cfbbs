import { describe, expect, it } from "vitest";

import {
  acceptsActivityStreams,
  isPublicNotePost,
  loadPublicNote,
  publicNoteQueries,
} from "@/modules/federation/object";

describe("public ActivityPub Note lookup", () => {
  it("matches both ActivityStreams media types", () => {
    expect(acceptsActivityStreams("application/activity+json")).toBe(true);
    expect(
      acceptsActivityStreams(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      ),
    ).toBe(true);
    expect(acceptsActivityStreams("text/html")).toBe(false);
  });

  it("queries only local, public, published posts outside private ancestry", () => {
    expect(publicNoteQueries.publicNoteQuery).toContain(
      "posts.origin = 'local'",
    );
    expect(publicNoteQueries.publicNoteQuery).toContain(
      "posts.visibility = 'public'",
    );
    expect(publicNoteQueries.publicNoteQuery).toContain(
      "posts.state = 'published'",
    );
    expect(publicNoteQueries.publicNoteQuery).toContain(
      "boards.visibility = 'public'",
    );
    expect(publicNoteQueries.publicNoteQuery).toContain(
      "ancestor.visibility != 'public'",
    );
  });

  it("does not query D1 for malformed object IDs", async () => {
    let prepared = false;
    const post = await loadPublicNote(
      {
        prepare() {
          prepared = true;
          return {} as D1PreparedStatement;
        },
      } as D1Database,
      "../private",
    );

    expect(post).toBeNull();
    expect(prepared).toBe(false);
  });

  it("returns a valid local post from the parameterized D1 lookup", async () => {
    let boundPostId = "";
    const post = await loadPublicNote(
      {
        prepare() {
          return {
            bind(postId: string) {
              boundPostId = postId;
              return {
                async first() {
                  return {
                    id: "post-1",
                    authorHandle: "alice",
                    html: "<p>Hello</p>",
                    publishedAt: "2026-07-19T00:00:00.000Z",
                    updatedAt: "2026-07-19T00:00:00.000Z",
                    parentPostId: null,
                  };
                },
              };
            },
          } as D1PreparedStatement;
        },
      } as D1Database,
      "post-1",
    );

    expect(boundPostId).toBe("post-1");
    expect(post).toMatchObject({ authorHandle: "alice" });
    expect(post && isPublicNotePost(post)).toBe(true);
  });

  it("refuses a malformed author handle before serialization", () => {
    expect(
      isPublicNotePost({
        id: "post-1",
        authorHandle: "not a handle",
        html: "<p>Hello</p>",
        publishedAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
        parentPostId: null,
      }),
    ).toBe(false);
  });
});
