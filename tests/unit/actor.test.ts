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
    });
    expect(actor).not.toHaveProperty("federationPrivateKeyEncrypted");
  }));
