import { describe, expect, it } from "vitest";

import { noteObject } from "@/modules/federation/note";
import {
  extractRemoteNoteAttachments,
  mediaRecordsToNoteAttachments,
  validateAttachmentIds,
  validateUploadFile,
} from "@/modules/media";
import { authorizeMediaRead } from "@/modules/media/access";

describe("media upload validation", () => {
  it("accepts whitelisted image and document uploads under the size limit", () => {
    expect(
      validateUploadFile({
        contentType: "image/png",
        byteSize: 1024,
        filename: "shot.png",
      }),
    ).toMatchObject({ ok: true, kind: "image" });
    expect(
      validateUploadFile({
        contentType: "application/pdf",
        byteSize: 2048,
        filename: "doc.pdf",
      }),
    ).toMatchObject({ ok: true, kind: "document" });
  });

  it("rejects disallowed types, oversized files, and extension mismatches", () => {
    expect(
      validateUploadFile({
        contentType: "video/mp4",
        byteSize: 100,
        filename: "clip.mp4",
      }).ok,
    ).toBe(false);
    expect(
      validateUploadFile({
        contentType: "image/png",
        byteSize: 6 * 1024 * 1024,
        filename: "big.png",
      }).ok,
    ).toBe(false);
    expect(
      validateUploadFile({
        contentType: "image/png",
        byteSize: 100,
        filename: "shot.jpg",
      }).ok,
    ).toBe(false);
  });

  it("limits attachment ids to four valid identifiers", () => {
    expect(validateAttachmentIds(["a".repeat(8), "b".repeat(8)])).toEqual({
      ok: true,
      ids: ["a".repeat(8), "b".repeat(8)],
    });
    expect(
      validateAttachmentIds([
        "a".repeat(8),
        "b".repeat(8),
        "c".repeat(8),
        "d".repeat(8),
        "e".repeat(8),
      ]).ok,
    ).toBe(false);
    expect(validateAttachmentIds(["bad id"]).ok).toBe(false);
  });
});

describe("note attachment mapping", () => {
  it("maps local media records into ActivityPub Image/Document attachments", () => {
    const attachments = mediaRecordsToNoteAttachments("https://bbs.example.test", [
      {
        id: "mediaone123",
        uploaderUserId: "user-1",
        r2Key: "media/user-1/mediaone123.png",
        contentType: "image/png",
        byteSize: 12,
        sha256: "abc",
        originalFilename: "shot.png",
        kind: "image",
        createdAt: "2026-07-19T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: "mediadoc1234",
        uploaderUserId: "user-1",
        r2Key: "media/user-1/mediadoc1234.pdf",
        contentType: "application/pdf",
        byteSize: 20,
        sha256: "def",
        originalFilename: "notes.pdf",
        kind: "document",
        createdAt: "2026-07-19T00:00:00.000Z",
        deletedAt: null,
      },
    ]);
    expect(attachments).toEqual([
      {
        type: "Image",
        mediaType: "image/png",
        url: "https://bbs.example.test/media/mediaone123",
        name: "shot.png",
      },
      {
        type: "Document",
        mediaType: "application/pdf",
        url: "https://bbs.example.test/media/mediadoc1234",
        name: "notes.pdf",
      },
    ]);
    expect(
      noteObject("https://bbs.example.test", {
        id: "post-1",
        authorHandle: "alice",
        html: "<p>hi</p>",
        publishedAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
        parentPostId: null,
        attachments,
      }).attachment,
    ).toEqual(attachments);
  });

  it("extracts only safe remote attachment URLs", () => {
    expect(
      extractRemoteNoteAttachments({
        attachment: [
          {
            type: "Image",
            url: "https://remote.example/files/a.png",
            mediaType: "image/png",
            name: "a.png",
          },
          { type: "Document", url: "http://127.0.0.1/secret.pdf" },
          { type: "Link", href: "javascript:alert(1)" },
        ],
      }),
    ).toEqual([
      {
        url: "https://remote.example/files/a.png",
        mediaType: "image/png",
        name: "a.png",
      },
    ]);
  });
});

describe("private media access", () => {
  it("rejects anonymous readers for private or unattached media", async () => {
    const database = {
      prepare(sql: string) {
        return {
          bind() {
            if (sql.includes("FROM media_objects WHERE id")) {
              return {
                first: async () => ({
                  id: "mediaone123",
                  uploaderUserId: "user-1",
                  r2Key: "media/user-1/mediaone123.png",
                  contentType: "image/png",
                  byteSize: 10,
                  sha256: "abc",
                  originalFilename: "shot.png",
                  kind: "image",
                  createdAt: "2026-07-19T00:00:00.000Z",
                  deletedAt: null,
                }),
              };
            }
            // Linked to a private published post; anonymous should be denied.
            if (sql.includes("FROM post_attachments")) {
              return {
                first: async () => ({
                  postId: "post-1",
                  visibility: "private",
                  postState: "published",
                  boardId: "board-1",
                }),
              };
            }
            return {
              first: async () => null,
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as unknown as D1Database;

    const denied = await authorizeMediaRead({
      env: {
        DB: database,
        APP_ORIGIN: "https://bbs.example.test",
        BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      } as Env,
      request: new Request("https://bbs.example.test/media/mediaone123"),
      mediaId: "mediaone123",
    });
    expect(denied).toMatchObject({ ok: false, status: 401 });
  });
});
