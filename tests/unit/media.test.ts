import { describe, expect, it } from "vitest";

import { noteObject } from "@/modules/federation/note";
import {
  buildMediaStorageKey,
  createS3MediaStore,
  extractRemoteNoteAttachments,
  mediaRecordsToNoteAttachments,
  parseS3MediaConfig,
  storeUploadedMedia,
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
    const attachments = mediaRecordsToNoteAttachments(
      "https://bbs.example.test",
      [
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
      ],
    );
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

describe("media s3 storage", () => {
  it("builds stable object keys under the media prefix", () => {
    expect(
      buildMediaStorageKey({
        uploaderUserId: "user-1",
        mediaId: "mediaone123",
        extension: "png",
      }),
    ).toBe("media/user-1/mediaone123.png");
  });

  it("parses S3 config only when required fields exist", () => {
    expect(
      parseS3MediaConfig({
        S3_ENDPOINT: "https://s3.example.test",
        S3_BUCKET: "cfbbs-media",
        S3_ACCESS_KEY_ID: "AKIA",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).toMatchObject({
      endpoint: "https://s3.example.test",
      bucket: "cfbbs-media",
      region: "auto",
      forcePathStyle: true,
    });
    expect(parseS3MediaConfig({})).toBeNull();
  });

  it("stores bytes through the blob store and records metadata in D1", async () => {
    const puts: Array<{
      key: string;
      value: ArrayBuffer;
      contentType?: string;
    }> = [];
    const inserts: unknown[][] = [];
    const store = {
      async put(
        key: string,
        value: ArrayBuffer,
        options?: { contentType?: string },
      ) {
        puts.push({ key, value, contentType: options?.contentType });
      },
      async get() {
        return null;
      },
      async delete() {},
    };
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            if (sql.startsWith("INSERT INTO media_objects")) {
              inserts.push(params);
              return { run: async () => ({ meta: { changes: 1 } }) };
            }
            return {
              first: async () => null,
              all: async () => ({ results: [] }),
              run: async () => ({ meta: { changes: 0 } }),
            };
          },
        };
      },
    } as unknown as D1Database;

    const bytes = new TextEncoder().encode("hello-image").buffer;
    const stored = await storeUploadedMedia({
      database,
      store,
      uploaderUserId: "user-1",
      filename: "shot.png",
      contentType: "image/png",
      bytes,
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toContain("media/user-1/");
    expect(puts[0]?.contentType).toBe("image/png");
    expect(inserts[0]?.[2]).toBe(puts[0]?.key);
    expect(stored.media.contentType).toBe("image/png");
  });

  it("signs path-style PutObject requests for S3-compatible endpoints", async () => {
    const requests: Array<{ url: string; method: string; headers: Headers }> =
      [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = new Request(input, init);
      requests.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    try {
      const store = createS3MediaStore({
        endpoint: "https://s3.example.test",
        region: "us-east-1",
        bucket: "cfbbs-media",
        accessKeyId: "AKIATEST",
        secretAccessKey: "testsecret",
        forcePathStyle: true,
      });
      const body = new TextEncoder().encode("png-bytes").buffer;
      await store.put("media/user-1/a.png", body, {
        contentType: "image/png",
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("PUT");
      expect(requests[0]?.url).toBe(
        "https://s3.example.test/cfbbs-media/media/user-1/a.png",
      );
      expect(requests[0]?.headers.get("authorization")).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/us-east-1\/s3\/aws4_request/,
      );
      expect(requests[0]?.headers.get("x-amz-content-sha256")).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(requests[0]?.headers.get("content-type")).toBe("image/png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
