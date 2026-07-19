import { describe, expect, it } from "vitest";

import {
  createBoundedRemoteDocumentLoader,
  isActivityStreamsContentType,
  remoteDocumentMaxBytes,
  remoteDocumentMaxRedirects,
} from "@/modules/federation/remote-fetch";

function response(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, init);
}

describe("bounded remote ActivityPub document fetches", () => {
  it("only accepts ActivityStreams JSON representations", () => {
    expect(isActivityStreamsContentType("application/activity+json")).toBe(
      true,
    );
    expect(
      isActivityStreamsContentType(
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
      ),
    ).toBe(true);
    expect(isActivityStreamsContentType("application/json")).toBe(false);
    expect(isActivityStreamsContentType("text/html")).toBe(false);
  });

  it("uses manual bounded redirects and returns parsed ActivityStreams JSON", async () => {
    const calls: Array<{ url: string; redirect?: RequestRedirect }> = [];
    const loader = createBoundedRemoteDocumentLoader(async (url, init) => {
      calls.push({ url: String(url), redirect: init?.redirect });
      return calls.length === 1
        ? response(null, {
            status: 302,
            headers: { location: "/actor" },
          })
        : response('{"type":"Person"}', {
            headers: { "content-type": "application/activity+json" },
          });
    });

    await expect(loader("https://remote.example/start")).resolves.toEqual({
      contextUrl: null,
      document: { type: "Person" },
      documentUrl: "https://remote.example/actor",
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.redirect === "manual")).toBe(true);
  });

  it("rejects private redirects, unsupported media, and oversized responses", async () => {
    const privateRedirect = createBoundedRemoteDocumentLoader(async () =>
      response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
    );
    await expect(
      privateRedirect("https://remote.example/actor"),
    ).rejects.toThrow("public HTTPS");

    const wrongType = createBoundedRemoteDocumentLoader(async () =>
      response("<html />", { headers: { "content-type": "text/html" } }),
    );
    await expect(wrongType("https://remote.example/actor")).rejects.toThrow(
      "unsupported content type",
    );

    const oversized = createBoundedRemoteDocumentLoader(async () =>
      response("{}", {
        headers: {
          "content-length": String(remoteDocumentMaxBytes + 1),
          "content-type": "application/activity+json",
        },
      }),
    );
    await expect(oversized("https://remote.example/actor")).rejects.toThrow(
      "response size",
    );
  });

  it("stops after the configured redirect limit", async () => {
    const loader = createBoundedRemoteDocumentLoader(async () =>
      response(null, {
        status: 302,
        headers: { location: "/again" },
      }),
    );

    await expect(loader("https://remote.example/actor")).rejects.toThrow(
      "redirect limit",
    );
    expect(remoteDocumentMaxRedirects).toBe(3);
  });
});
