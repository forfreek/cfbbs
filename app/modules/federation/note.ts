import { actorId, noteId } from "./identifiers";
import type { NoteAttachmentJson } from "@/modules/media/federation";

export type PublicPost = {
  id: string;
  authorHandle: string;
  html: string;
  publishedAt: string;
  updatedAt: string;
  parentPostId: string | null;
  attachments?: NoteAttachmentJson[];
  hashtags?: readonly { tag: string; name?: string }[];
  mentions?: readonly { href: string; name: string }[];
  quote?: { uri: string; html?: string | null; title?: string | null } | null;
  poll?: {
    multiple: boolean;
    options: readonly { name: string; votesCount?: number }[];
    closesAt?: string | null;
    votersCount?: number;
  } | null;
};

export function noteObject(origin: string, post: PublicPost) {
  const id = noteId(origin, post.id);
  const tags = [
    ...(post.hashtags ?? []).map((tag) => ({
      type: "Hashtag",
      href: new URL(`/tags/${encodeURIComponent(tag.tag)}`, origin).href,
      name: `#${tag.name ?? tag.tag}`,
    })),
    ...(post.mentions ?? []).map((mention) => ({
      type: "Mention",
      href: mention.href,
      name: mention.name.startsWith("@") ? mention.name : `@${mention.name}`,
    })),
  ];
  const poll = post.poll
    ? {
        ...(post.poll.multiple
          ? {
              anyOf: post.poll.options.map((option) => ({
                type: "Note",
                name: option.name,
                replies: {
                  type: "Collection",
                  totalItems: option.votesCount ?? 0,
                },
              })),
            }
          : {
              oneOf: post.poll.options.map((option) => ({
                type: "Note",
                name: option.name,
                replies: {
                  type: "Collection",
                  totalItems: option.votesCount ?? 0,
                },
              })),
            }),
        ...(post.poll.closesAt ? { closed: post.poll.closesAt } : {}),
        ...(post.poll.votersCount !== undefined
          ? { votersCount: post.poll.votersCount }
          : {}),
      }
    : null;
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: poll ? "Question" : "Note",
    attributedTo: actorId(origin, post.authorHandle),
    content: post.html,
    published: post.publishedAt,
    updated: post.updatedAt,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    ...(post.parentPostId
      ? { inReplyTo: noteId(origin, post.parentPostId) }
      : {}),
    ...(post.attachments && post.attachments.length > 0
      ? { attachment: post.attachments }
      : {}),
    ...(tags.length > 0 ? { tag: tags } : {}),
    ...(post.quote
      ? {
          quote: post.quote.uri,
          quoteUrl: post.quote.uri,
          _misskey_quote: post.quote.uri,
          quoteUri: post.quote.uri,
        }
      : {}),
    ...(poll ?? {}),
  };
}
