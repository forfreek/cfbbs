import { describe, expect, it } from "vitest";

import {
  acceptsActivityStreams,
  handlePublicNoteActivity,
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

  it("serves activity+json Notes from the Worker short-circuit", async () => {
    const response = await handlePublicNoteActivity(
      new Request("https://bbs.example.test/objects/post-1", {
        headers: { accept: "application/activity+json" },
      }),
      {
        prepare(sql: string) {
          return {
            bind() {
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
                async all() {
                  return { results: [] };
                },
              };
            },
          } as D1PreparedStatement;
        },
      } as D1Database,
      "https://bbs.example.test",
    );

    expect(response).not.toBeNull();
    expect(response?.headers.get("content-type")).toBe(
      "application/activity+json",
    );
    await expect(response!.json()).resolves.toMatchObject({
      type: "Note",
      id: "https://bbs.example.test/objects/post-1",
      attributedTo: "https://bbs.example.test/users/alice",
    });
  });

  it("ignores non-ActivityStreams object requests", async () => {
    const response = await handlePublicNoteActivity(
      new Request("https://bbs.example.test/objects/post-1", {
        headers: { accept: "text/html" },
      }),
      {
        prepare() {
          throw new Error("should not query D1");
        },
      } as unknown as D1Database,
      "https://bbs.example.test",
    );
    expect(response).toBeNull();
  });
});
