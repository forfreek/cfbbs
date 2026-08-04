import { describe, expect, it } from "vitest";
import {
  extractHashtagNames,
  extractMentionHandles,
} from "@/modules/forum/mentions";
import {
  validatePollInput,
  validatePollVote,
  validateReactionEmoji,
} from "@/modules/forum/content";
import { noteObject } from "@/modules/federation/note";
import { parseRemoteNoteMetadata } from "@/modules/federation/p2";

describe("P2 content parsing", () => {
  it("extracts tags and mentions without scanning code or link URLs", () => {
    const markdown =
      "正文 #CFBBS @alice [#linked](https://example.test/@bob#url) `#code @ignored`\n\n```\n#fenced @nobody\n```";
    expect(extractHashtagNames(markdown)).toEqual([
      { tag: "cfbbs", displayName: "CFBBS" },
    ]);
    expect(extractMentionHandles(markdown)).toEqual(["alice"]);
  });

  it("enforces poll shape and immutable vote selection", () => {
    expect(
      validatePollInput({ options: ["A"], multiple: false, closesAt: null }).ok,
    ).toBe(false);
    expect(
      validatePollInput({
        options: ["A", "B"],
        multiple: false,
        closesAt: null,
      }),
    ).toMatchObject({ ok: true });
    expect(validatePollVote(["a", "b"], false).ok).toBe(false);
    expect(validatePollVote(["a", "b"], true).ok).toBe(true);
  });

  it("keeps reactions on the local whitelist", () => {
    expect(validateReactionEmoji("👍")).toBe(true);
    expect(validateReactionEmoji("<script>")).toBe(false);
  });

  it("maps Note tags, quote compatibility fields, and Question polls", () => {
    const object = noteObject("https://bbs.example", {
      id: "post-1",
      authorHandle: "alice",
      html: "hello",
      publishedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      parentPostId: null,
      hashtags: [{ tag: "cfbbs", name: "CFBBS" }],
      quote: { uri: "https://remote.example/notes/1" },
      poll: { multiple: false, options: [{ name: "A" }, { name: "B" }] },
    });
    expect(object.type).toBe("Question");
    expect(object.tag).toEqual([
      {
        type: "Hashtag",
        href: "https://bbs.example/tags/cfbbs",
        name: "#CFBBS",
      },
    ]);
    expect(object._misskey_quote).toBe("https://remote.example/notes/1");
    expect(object.oneOf).toHaveLength(2);
  });

  it("accepts safe remote hashtag, mention, quote, and poll metadata", () => {
    const metadata = parseRemoteNoteMetadata({
      tag: [
        { type: "Hashtag", name: "#News" },
        {
          type: "Mention",
          name: "@alice",
          href: "https://remote.example/users/alice",
        },
      ],
      quoteUri: "https://remote.example/notes/2",
      oneOf: [{ name: "yes" }, { name: "no" }],
    });
    expect(metadata.hashtags[0]).toEqual({ tag: "news", displayName: "News" });
    expect(metadata.mentions[0].actorUri).toBe(
      "https://remote.example/users/alice",
    );
    expect(metadata.quoteUri).toBe("https://remote.example/notes/2");
    expect(metadata.poll).toMatchObject({
      multiple: false,
      options: ["yes", "no"],
    });
  });
});
