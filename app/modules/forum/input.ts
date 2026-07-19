export function validateThreadInput(input: {
  title: string;
  markdown: string;
}) {
  const title = input.title.trim();
  const markdown = input.markdown.trim();
  if (title.length < 1 || title.length > 200) {
    return { ok: false as const, message: "主题标题应为 1 到 200 个字符。" };
  }
  if (markdown.length < 1 || markdown.length > 20_000) {
    return { ok: false as const, message: "主题内容应为 1 到 20000 个字符。" };
  }
  return { ok: true as const, value: { title, markdown } };
}

export function validateReplyInput(input: { markdown: string }) {
  const markdown = input.markdown.trim();
  if (markdown.length < 1 || markdown.length > 20_000) {
    return { ok: false as const, message: "回复内容应为 1 到 20000 个字符。" };
  }
  return { ok: true as const, value: { markdown } };
}
