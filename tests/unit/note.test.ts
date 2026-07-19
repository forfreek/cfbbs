import { describe, expect, it } from "vitest";
import { noteObject } from "@/modules/federation/note";
describe("ActivityPub Notes", () =>
  it("maps public replies with their parent relationship", () =>
    expect(
      noteObject("https://bbs.example.test", {
        id: "reply",
        authorHandle: "alice",
        html: "<p>Hello</p>",
        publishedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        parentPostId: "root",
      }),
    ).toMatchObject({
      type: "Note",
      inReplyTo: "https://bbs.example.test/objects/root",
      attributedTo: "https://bbs.example.test/users/alice",
    })));
