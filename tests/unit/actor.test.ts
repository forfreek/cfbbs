import { describe, expect, it } from "vitest";
import { personActor } from "@/modules/federation/actor";
describe("ActivityPub Person", () =>
  it("serializes a public profile without internal fields", () => {
    const actor = personActor("https://bbs.example.test", {
      handle: "alice",
      displayName: "Alice",
      bio: "Hello",
      avatarUrl: null,
    });
    expect(actor).toMatchObject({
      type: "Person",
      id: "https://bbs.example.test/users/alice",
      inbox: "https://bbs.example.test/users/alice/inbox",
      endpoints: { sharedInbox: "https://bbs.example.test/inbox" },
    });
    expect(actor).not.toHaveProperty("federationPrivateKeyEncrypted");
  }));

describe("ActivityPub actor signing key", () =>
  it("publishes only the public PEM under the stable actor key ID", () => {
    const actor = personActor("https://bbs.example.test", {
      handle: "alice",
      displayName: "Alice",
      bio: "Hello",
      avatarUrl: null,
      publicKeyPem:
        "-----BEGIN PUBLIC KEY-----\\npublic\\n-----END PUBLIC KEY-----",
    });

    expect(actor).toMatchObject({
      publicKey: {
        id: "https://bbs.example.test/users/alice#main-key",
        owner: "https://bbs.example.test/users/alice",
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\\npublic\\n-----END PUBLIC KEY-----",
      },
    });
  }));
