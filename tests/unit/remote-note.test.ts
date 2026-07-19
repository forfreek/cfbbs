import { describe, expect, it } from "vitest";

import {
  remoteNoteQueries,
  remoteNoteStatements,
  remoteThreadReplyStatements,
  sanitizeRemoteNoteHtml,
  validateRemoteNote,
} from "@/modules/federation/remote-note";

const note = {
  uri: "https://remote.example/notes/1",
  actorUri: "https://remote.example/users/bob",
  inReplyToUri: null,
  contentHtml:
    '<p>Hello <strong>world</strong><script>alert(1)</script><a href="javascript:alert(1)">bad</a></p>',
  publishedAt: "2026-07-19T00:00:00.000Z",
  updatedAt: null,
};

describe("remote Note persistence", () => {
  it("sanitizes remote HTML before it can be rendered", () => {
    const html = sanitizeRemoteNoteHtml(note.contentHtml);
    expect(html).toContain("<strong>world</strong>");
    expect(html).not.toMatch(/script|javascript:/i);
  });

  it("stores public remote Notes with a 90 day retention deadline", () => {
    const [statement] = remoteNoteStatements(note, "2026-07-19T00:00:00.000Z");
    expect(statement?.sql).toContain("ON CONFLICT(uri) DO UPDATE");
    expect(statement?.params).toEqual(
      expect.arrayContaining([
        note.uri,
        note.actorUri,
        "2026-10-17T00:00:00.000Z",
      ]),
    );
    expect(statement?.params).not.toContain(note.contentHtml);
  });

  it("rejects unsafe object IDs and empty sanitized content", () => {
    expect(
      validateRemoteNote({ ...note, uri: "http://127.0.0.1/note" }).ok,
    ).toBe(false);
    expect(
      validateRemoteNote({ ...note, contentHtml: "<script>x</script>" }).ok,
    ).toBe(false);
  });

  it("only selects undeleted public Notes from currently followed actors", () => {
    const { followedRemoteNotesQuery } = remoteNoteQueries;
    expect(followedRemoteNotesQuery).toContain("follower_actor_id = ?");
    expect(followedRemoteNotesQuery).toContain("state = 'accepted'");
    expect(followedRemoteNotesQuery).toContain("deleted_at IS NULL");
    expect(followedRemoteNotesQuery).toContain("blocked_at IS NULL");
  });

  it("adds a remote reply once and upserts it by federation object ID", () => {
    const statements = remoteThreadReplyStatements(
      {
        ...note,
        postId: "remote-post-1",
        threadId: "thread-1",
        parentPostId: "post-1",
      },
      "2026-07-19T00:00:00.000Z",
    );
    expect(statements).toHaveLength(3);
    expect(statements[1]?.sql).toContain("NOT EXISTS");
    expect(statements[1]?.params).toContain(note.uri);
    expect(statements[2]?.sql).toContain(
      "ON CONFLICT(federation_object_id) DO UPDATE",
    );
    expect(statements[2]?.params).toEqual(
      expect.arrayContaining([note.actorUri, note.uri, "post-1"]),
    );
  });
});
