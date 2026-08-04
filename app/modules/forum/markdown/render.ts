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
  "img",
];

const inlineMentionPattern = /(^|[\s([{"'])@([a-z0-9_]{3,32})\b/gi;
const inlineHashtagPattern = /(^|[\s([{"'])#([\p{L}\p{N}_-]{1,64})/gu;

function isSafeImageSrc(value: string) {
  try {
    if (value.startsWith("/media/")) {
      return /^\/media\/[a-zA-Z0-9_-]{8,128}$/.test(value);
    }
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function transformImageTag(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const src = attribs.src ?? "";
  if (!isSafeImageSrc(src)) {
    return {
      tagName: "span",
      text: "",
      attribs: {},
    };
  }
  return {
    tagName,
    attribs: {
      src,
      alt: attribs.alt ?? "",
      title: attribs.title ?? "",
      loading: "lazy",
      decoding: "async",
    },
  };
}

export function renderMarkdown(markdown: string) {
  return sanitizeHtml(marked.parse(markdown, { async: false }), {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener" }),
      img: transformImageTag,
    },
    textFilter: (text, tagName) => {
      if (tagName === "a" || tagName === "code" || tagName === "pre")
        return text;
      return text
        .replace(inlineMentionPattern, '$1<a href="/users/$2">@$2</a>')
        .replace(inlineHashtagPattern, '$1<a href="/tags/$2">#$2</a>');
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
