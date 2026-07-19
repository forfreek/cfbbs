import { describe, expect, it } from "vitest";

import { validateReplyInput, validateThreadInput } from "@/modules/forum/input";

describe("forum compose input", () => {
  it("trims valid thread titles and Markdown", () => {
    expect(
      validateThreadInput({ title: " Hello ", markdown: " Content " }),
    ).toEqual({ ok: true, value: { title: "Hello", markdown: "Content" } });
  });

  it("rejects empty and excessively long content", () => {
    expect(validateThreadInput({ title: "", markdown: "body" })).toMatchObject({
      ok: false,
    });
    expect(validateReplyInput({ markdown: "x".repeat(20_001) })).toMatchObject({
      ok: false,
    });
  });
});
