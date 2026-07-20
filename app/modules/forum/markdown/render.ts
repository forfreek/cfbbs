import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export const maxMarkdownLength = 20_000;

const allowedTags = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
];

export function renderMarkdown(markdown: string) {
  return sanitizeHtml(marked.parse(markdown, { async: false }), {
    allowedTags,
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["https", "http", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener" }),
    },
  });
}

export function renderMarkdownPreview(value: unknown) {
  if (typeof value !== "string") {
    return { ok: false as const, message: "Markdown 内容无效。" };
  }
  if (value.length > maxMarkdownLength) {
    return {
      ok: false as const,
      message: `Markdown 内容不能超过 ${maxMarkdownLength} 个字符。`,
    };
  }
  return { ok: true as const, html: renderMarkdown(value) };
}
