import { marked, type Token } from "marked";

const mentionPattern = /(^|[\s([{"'])@([a-z0-9_]{3,32})\b/gi;
const hashtagPattern = /(^|[\s([{"'])#([\p{L}\p{N}_-]{1,64})/gu;

function markdownTextTokens(markdown: string) {
  const output: string[] = [];
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (
        token.type === "code" ||
        token.type === "codespan" ||
        token.type === "html"
      ) {
        continue;
      }
      if (token.type === "link") {
        // Skip the full link token. This prevents URL fragments and linked
        // labels from becoming structured mentions/tags accidentally.
        continue;
      }
      if (token.type === "image") continue;
      if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens);
      else if ("items" in token && Array.isArray(token.items)) {
        for (const item of token.items) visit(item.tokens);
      } else if ("text" in token && typeof token.text === "string") {
        output.push(token.text);
      }
    }
  };
  visit(marked.lexer(markdown));
  return output.join("\n");
}

export function extractMentionHandles(markdown: string) {
  const handles = new Set<string>();
  for (const match of markdownTextTokens(markdown).matchAll(mentionPattern)) {
    handles.add(match[2].toLowerCase());
  }
  return [...handles];
}

export function extractHashtagNames(markdown: string) {
  const tags = new Map<string, string>();
  for (const match of markdownTextTokens(markdown).matchAll(hashtagPattern)) {
    const displayName = match[2];
    const normalized = displayName.toLocaleLowerCase("en-US");
    if (!tags.has(normalized)) tags.set(normalized, displayName);
  }
  return [...tags].map(([tag, displayName]) => ({ tag, displayName }));
}

export function extractContentTokens(markdown: string) {
  return {
    mentions: extractMentionHandles(markdown),
    hashtags: extractHashtagNames(markdown),
  };
}

export async function loadMentionedUserIds(
  database: D1Database,
  markdown: string,
) {
  const handles = extractMentionHandles(markdown);
  if (handles.length === 0) return [] as string[];
  const placeholders = handles.map(() => "?").join(", ");
  const rows = await database
    .prepare(
      `SELECT user.id AS userId FROM user
       INNER JOIN profiles ON profiles.user_id = user.id
       WHERE profiles.handle IN (${placeholders}) AND user.status = 'active'`,
    )
    .bind(...handles)
    .all<{ userId: string }>();
  return rows.results.map((row) => row.userId);
}
