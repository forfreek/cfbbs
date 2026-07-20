import { describe, expect, it } from "vitest";

import { localActorInsertStatements } from "@/modules/federation/local-actor";

describe("local federation actors", () => {
  it("stores the encrypted private key and public actor data in one batch", () => {
    const statements = localActorInsertStatements(
      {
        userId: "user-1",
        handle: "alice",
        displayName: "Alice",
        origin: "https://bbs.example.test",
      },
      {
        publicKeyPem:
          "-----BEGIN PUBLIC KEY-----\\npublic\\n-----END PUBLIC KEY-----",
        privateKeyEncrypted: '{"version":1,"ciphertext":"secret"}',
      },
      "2026-07-19T00:00:00.000Z",
    );

    expect(statements).toHaveLength(3);
    expect(statements[0].sql).toContain("INSERT INTO profiles");
    expect(statements[0].params).toContain(
      '{"version":1,"ciphertext":"secret"}',
    );
    expect(statements[1].sql).toContain("INSERT INTO federation_actors");
    expect(statements[1].params).toEqual(
      expect.arrayContaining([
        "https://bbs.example.test/users/alice",
        "@alice@bbs.example.test",
        "https://bbs.example.test/users/alice/inbox",
        "https://bbs.example.test/inbox",
        "https://bbs.example.test/users/alice/outbox",
        "https://bbs.example.test/users/alice/followers",
        "-----BEGIN PUBLIC KEY-----\\npublic\\n-----END PUBLIC KEY-----",
      ]),
    );
    expect(statements[2]).toMatchObject({
      sql: expect.stringContaining("INSERT OR IGNORE INTO group_members"),
      params: expect.arrayContaining([
        "00000000-0000-0000-0000-000000000003",
        "user-1",
      ]),
    });
  });

  it("rejects invalid handles before creating any statements", () => {
    expect(() =>
      localActorInsertStatements(
        {
          userId: "user-1",
          handle: "Invalid Handle",
          displayName: "Alice",
          origin: "https://bbs.example.test",
        },
        { publicKeyPem: "public", privateKeyEncrypted: "private" },
        "2026-07-19T00:00:00.000Z",
      ),
    ).toThrow("valid federation handle");
  });
});
