import { describe, expect, it } from "vitest";

import {
  lookupRemoteResource,
  parseRemoteLookupTarget,
  remoteActorFromDocument,
  resolveRemoteActorForFollow,
} from "@/modules/federation/remote-lookup";

describe("remote lookup", () => {
  it("only treats a complete handle or public HTTPS URL as a remote lookup", () => {
    expect(parseRemoteLookupTarget("alice@remote.example")).toBeNull();
    expect(parseRemoteLookupTarget("@alice@127.0.0.1")).toBeNull();
    expect(parseRemoteLookupTarget("http://remote.example/alice")).toBeNull();
    expect(parseRemoteLookupTarget("federated discussion")).toBeNull();
    expect(parseRemoteLookupTarget("@alice@remote.example")).toEqual({
      kind: "handle",
      account: "alice@remote.example",
      webFingerUrl:
        "https://remote.example/.well-known/webfinger?resource=acct%3Aalice%40remote.example",
    });
    expect(
      parseRemoteLookupTarget("https://remote.example/actors/alice"),
    ).toEqual({
      kind: "url",
      url: "https://remote.example/actors/alice",
    });
  });

  it("resolves a complete remote handle through WebFinger before loading its actor", async () => {
    const calls: string[] = [];
    const target = parseRemoteLookupTarget("@alice@remote.example");
    if (!target) throw new Error("Expected a remote handle target.");

    await expect(
      lookupRemoteResource(target, async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/.well-known/webfinger")) {
          return new Response(
            JSON.stringify({
              subject: "acct:alice@remote.example",
              links: [
                {
                  rel: "self",
                  type: "application/activity+json",
                  href: "https://remote.example/actors/alice",
                },
              ],
            }),
            { headers: { "content-type": "application/jrd+json" } },
          );
        }
        return new Response(
          JSON.stringify({
            id: "https://remote.example/actors/alice",
            type: "Person",
            name: "Alice",
          }),
          { headers: { "content-type": "application/activity+json" } },
        );
      }),
    ).resolves.toEqual({
      kind: "actor",
      name: "Alice",
      type: "Person",
      url: "https://remote.example/actors/alice",
    });
    expect(calls).toEqual([
      "https://remote.example/.well-known/webfinger?resource=acct%3Aalice%40remote.example",
      "https://remote.example/actors/alice",
    ]);
  });

  it("rejects a WebFinger response that does not identify the requested account", async () => {
    const target = parseRemoteLookupTarget("@alice@remote.example");
    if (!target) throw new Error("Expected a remote handle target.");

    await expect(
      lookupRemoteResource(
        target,
        async () =>
          new Response(
            JSON.stringify({ subject: "acct:bob@remote.example", links: [] }),
            { headers: { "content-type": "application/jrd+json" } },
          ),
      ),
    ).rejects.toThrow("does not match the requested handle");
  });

  it("extracts follow delivery fields from a remote actor document", () => {
    expect(
      remoteActorFromDocument(
        {
          id: "https://remote.example/users/bob",
          type: "Person",
          preferredUsername: "bob",
          inbox: "https://remote.example/users/bob/inbox",
          endpoints: { sharedInbox: "https://remote.example/inbox" },
          publicKey: {
            id: "https://remote.example/users/bob#main-key",
            publicKeyPem:
              "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n",
          },
        },
        "https://remote.example/users/bob",
      ),
    ).toEqual({
      uri: "https://remote.example/users/bob",
      inboxUrl: "https://remote.example/users/bob/inbox",
      sharedInboxUrl: "https://remote.example/inbox",
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----",
      name: "bob",
    });
  });

  it("resolves a remote actor for outbound follow delivery", async () => {
    const target = parseRemoteLookupTarget("https://remote.example/users/bob");
    if (!target) throw new Error("Expected a remote URL target.");
    await expect(
      resolveRemoteActorForFollow(target, async () => {
        return new Response(
          JSON.stringify({
            id: "https://remote.example/users/bob",
            type: "Person",
            preferredUsername: "bob",
            inbox: "https://remote.example/users/bob/inbox",
            publicKey: {
              publicKeyPem:
                "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n",
            },
          }),
          { headers: { "content-type": "application/activity+json" } },
        );
      }),
    ).resolves.toMatchObject({
      uri: "https://remote.example/users/bob",
      inboxUrl: "https://remote.example/users/bob/inbox",
      sharedInboxUrl: null,
      name: "bob",
    });
  });
});
