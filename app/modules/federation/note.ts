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
};

export function noteObject(origin: string, post: PublicPost) {
  const id = noteId(origin, post.id);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: "Note",
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
  };
}
