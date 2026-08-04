import { isSafeRemoteUrl } from "./remote-url";

export type RemoteNoteMetadata = {
  hashtags: { tag: string; displayName: string }[];
  mentions: { actorUri: string; handle: string }[];
  quoteUri: string | null;
  poll: {
    multiple: boolean;
    closesAt: string | null;
    options: string[];
  } | null;
};

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof value.value === "string"
  )
    return value.value;
  return "";
}

export function parseRemoteNoteMetadata(value: unknown): RemoteNoteMetadata {
  const object =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawTags = Array.isArray(object.tag)
    ? object.tag
    : Array.isArray(object.tags)
      ? object.tags
      : [];
  const hashtags = new Map<string, { tag: string; displayName: string }>();
  const mentions: { actorUri: string; handle: string }[] = [];
  for (const raw of rawTags) {
    if (!raw || typeof raw !== "object") continue;
    const tag = raw as Record<string, unknown>;
    const name = stringValue(tag.name);
    const href = stringValue(tag.href);
    const type = stringValue(tag.type).toLowerCase();
    if (type === "hashtag" || name.startsWith("#")) {
      const displayName = name.replace(/^#/, "").trim();
      const normalized = displayName.toLocaleLowerCase("en-US");
      if (
        /^[\p{L}\p{N}_-]{1,64}$/u.test(displayName) &&
        !hashtags.has(normalized)
      )
        hashtags.set(normalized, { tag: normalized, displayName });
    } else if (type === "mention" && isSafeRemoteUrl(href)) {
      mentions.push({
        actorUri: href,
        handle: name.replace(/^@/, "").slice(0, 64),
      });
    }
  }
  const quoteCandidate = [
    object.quote,
    object.quoteUrl,
    object._misskey_quote,
    object.quoteUri,
  ].find((candidate) => typeof candidate === "string") as string | undefined;
  const quoteUri =
    quoteCandidate && isSafeRemoteUrl(quoteCandidate) ? quoteCandidate : null;
  const optionsRaw = Array.isArray(object.oneOf)
    ? object.oneOf
    : Array.isArray(object.anyOf)
      ? object.anyOf
      : [];
  const options = optionsRaw
    .map((option) =>
      option && typeof option === "object"
        ? stringValue((option as Record<string, unknown>).name)
        : "",
    )
    .filter(Boolean)
    .slice(0, 10);
  const closed = stringValue(object.closed);
  return {
    hashtags: [...hashtags.values()],
    mentions,
    quoteUri,
    poll:
      options.length >= 2
        ? {
            multiple: Array.isArray(object.anyOf),
            closesAt: closed || null,
            options,
          }
        : null,
  };
}
