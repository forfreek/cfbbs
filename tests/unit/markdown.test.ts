import { describe, expect, it } from "vitest";
import {
  maxMarkdownLength,
  renderMarkdown,
  renderMarkdownPreview,
} from "@/modules/forum/markdown/render";

describe("post markdown", () => {
  it("renders ordinary markdown", () =>
    expect(renderMarkdown("**hello** [link](https://example.test)")).toContain(
      "<strong>hello</strong>",
    ));
  it("removes scripts, event handlers, and unsafe protocols", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>',
    );
    expect(html).not.toMatch(/script|onerror|javascript:/i);
  });

  it("uses the publication sanitizer for bounded Markdown previews", () => {
    expect(renderMarkdownPreview("[safe](https://example.test)")).toEqual({
      ok: true,
      html: '<p><a href="https://example.test">safe</a></p>\n',
    });
    expect(renderMarkdownPreview("<script>alert(1)</script>")).toEqual({
      ok: true,
      html: "",
    });
    expect(renderMarkdownPreview("x".repeat(maxMarkdownLength + 1))).toEqual({
      ok: false,
      message: `Markdown 内容不能超过 ${maxMarkdownLength} 个字符。`,
    });
  });
});
