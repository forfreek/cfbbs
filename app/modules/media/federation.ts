import type { MediaObjectRecord } from "./types";
import { mediaObjectPublicUrl } from "./storage";

export type NoteAttachmentJson = {
  type: "Image" | "Document";
  mediaType: string;
  url: string;
  name: string;
};

export function mediaRecordsToNoteAttachments(
  origin: string,
  media: readonly MediaObjectRecord[],
): NoteAttachmentJson[] {
  return media.map((item) => ({
    type: item.kind === "image" ? "Image" : "Document",
    mediaType: item.contentType,
    url: mediaObjectPublicUrl(origin, item.id),
    name: item.originalFilename,
  }));
}
