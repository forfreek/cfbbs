import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/modules/forum/markdown/render";

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
});
