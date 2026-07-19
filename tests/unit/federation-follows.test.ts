import { describe, expect, it } from "vitest";

import {
  acceptRemoteFollow,
  acceptedRemoteFollowStatements,
  createOutboundFollow,
  createOutboundFollowActivity,
  createOutboundFollowUndoActivity,
  createFollowAcceptActivity,
  outboundFollowStatements,
  outboundFollowUndoStatements,
  settleOutboundFollow,
  undoOutboundFollow,
  undoRemoteFollow,
  type AcceptedRemoteFollow,
  type OutboundFollow,
  type OutboundFollowUndo,
} from "@/modules/federation/follows";

const input: AcceptedRemoteFollow = {
  eventId: "event-1",
  followActivityId: "https://remote.example/activities/follow-1",
  localActorId: "user-1",
  localHandle: "alice",
  origin: "https://bbs.example.test",
  follower: {
    uri: "https://remote.example/users/bob",
    inboxUrl: "https://remote.example/inbox",
    sharedInboxUrl: "https://remote.example/inbox/shared",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----",
    name: "Bob",
  },
};

const outboundInput: OutboundFollow = {
  eventId: "follow-event-1",
  localActorId: "user-1",
  localHandle: "alice",
  origin: "https://bbs.example.test",
  following: input.follower,
};

const outboundUndoInput: OutboundFollowUndo = {
  ...outboundInput,
  eventId: "undo-event-1",
  followActivityId: "https://bbs.example.test/activities/follow/follow-event-1",
};

describe("accepted remote follows", () => {
  it("creates a direct Accept activity addressed to the original Follow", () => {
    expect(createFollowAcceptActivity(input)).toEqual({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://bbs.example.test/activities/accept/event-1",
      type: "Accept",
      actor: "https://bbs.example.test/users/alice",
      object: "https://remote.example/activities/follow-1",
      to: "https://remote.example/users/bob",
    });
  });

  it("atomically records the follower and queues one direct delivery", () => {
    const statements = acceptedRemoteFollowStatements(
      input,
      "2026-07-19T00:00:00.000Z",
    );

    expect(statements).toHaveLength(4);
    expect(statements[0]?.sql).toContain("ON CONFLICT(uri)");
    expect(statements[1]?.sql).toContain("state = 'accepted'");
    expect(statements[2]?.sql).toContain("'Accept'");
    expect(statements[2]?.sql).toContain("'direct'");
    expect(statements[3]?.params).toContain(
      "https://remote.example/inbox/shared",
    );
  });

  it("rejects unsafe remote delivery endpoints", () => {
    expect(() =>
      acceptedRemoteFollowStatements(
        {
          ...input,
          follower: { ...input.follower, inboxUrl: "http://127.0.0.1/inbox" },
        },
        "2026-07-19T00:00:00.000Z",
      ),
    ).toThrow("Remote follower inbox must be a public HTTPS URL.");
  });

  it("uses D1 batch so the state change and acceptance cannot diverge", async () => {
    const batches: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return { sql, params };
          },
        };
      },
      async batch(statements: unknown[]) {
        batches.push(statements);
        return [];
      },
    } as unknown as D1Database;

    await acceptRemoteFollow(database, input);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
  });

  it("only marks the exact accepted relationship as undone", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      undoRemoteFollow(database, {
        followActivityId: input.followActivityId,
        followerActorUri: input.follower.uri,
        localActorId: input.localActorId,
      }),
    ).resolves.toBe(true);
    expect(statements[0]?.sql).toContain("state = 'accepted'");
    expect(statements[0]?.params).toEqual(
      expect.arrayContaining([
        input.followActivityId,
        input.follower.uri,
        input.localActorId,
      ]),
    );
  });

  it("only settles the matching pending outbound Follow", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            statements.push({ sql, params });
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(
      settleOutboundFollow(database, {
        followActivityId: input.followActivityId,
        localActorId: input.localActorId,
        remoteActorUri: input.follower.uri,
        state: "accepted",
      }),
    ).resolves.toBe(true);
    expect(statements[0]?.sql).toContain("state = 'pending'");
    expect(statements[0]?.params).toEqual(
      expect.arrayContaining([
        "accepted",
        input.followActivityId,
        input.localActorId,
        input.follower.uri,
      ]),
    );
  });

  it("creates a direct Follow activity addressed to the remote Actor", () => {
    expect(createOutboundFollowActivity(outboundInput)).toEqual({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://bbs.example.test/activities/follow/follow-event-1",
      type: "Follow",
      actor: "https://bbs.example.test/users/alice",
      object: "https://remote.example/users/bob",
      to: "https://remote.example/users/bob",
    });
  });

  it("atomically saves an outbound Follow and its direct delivery", () => {
    const statements = outboundFollowStatements(
      outboundInput,
      "2026-07-19T00:00:00.000Z",
    );

    expect(statements).toHaveLength(4);
    expect(statements[0]?.sql).toContain("ON CONFLICT(uri)");
    expect(statements[1]?.sql).toContain("state = 'pending'");
    expect(statements[2]?.sql).toContain("'Follow'");
    expect(statements[2]?.sql).toContain("'direct'");
    expect(statements[3]?.params).toContain(
      "https://remote.example/inbox/shared",
    );
  });

  it("uses one D1 batch for the outbound relationship and delivery", async () => {
    const batches: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return { sql, params };
          },
        };
      },
      async batch(statements: unknown[]) {
        batches.push(statements);
        return [];
      },
    } as unknown as D1Database;

    await createOutboundFollow(database, outboundInput);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
  });

  it("creates an Undo activity for the original local Follow", () => {
    expect(createOutboundFollowUndoActivity(outboundUndoInput)).toEqual({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: "https://bbs.example.test/activities/undo/undo-event-1",
      type: "Undo",
      actor: "https://bbs.example.test/users/alice",
      object: "https://bbs.example.test/activities/follow/follow-event-1",
      to: "https://remote.example/users/bob",
    });
  });

  it("only queues a direct Undo when the exact Follow is still active", () => {
    const statements = outboundFollowUndoStatements(
      outboundUndoInput,
      "2026-07-19T00:00:00.000Z",
    );

    expect(statements).toHaveLength(3);
    expect(statements[0]?.sql).toContain("WHERE EXISTS");
    expect(statements[0]?.sql).toContain("state IN ('pending', 'accepted')");
    expect(statements[1]?.params).toContain(
      "https://remote.example/inbox/shared",
    );
    expect(statements[2]?.sql).toContain("state = 'undone'");
    expect(statements[2]?.params).toEqual(
      expect.arrayContaining([
        "user-1",
        "https://remote.example/users/bob",
        "https://bbs.example.test/activities/follow/follow-event-1",
      ]),
    );
  });

  it("rejects an Undo for a Follow owned by another instance", () => {
    expect(() =>
      outboundFollowUndoStatements(
        {
          ...outboundUndoInput,
          followActivityId: "https://other.example/activities/follow/follow-1",
        },
        "2026-07-19T00:00:00.000Z",
      ),
    ).toThrow("Outbound Follow activity ID must belong to this instance.");
  });

  it("returns whether the Follow relationship was actually cancelled", async () => {
    const batches: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return { sql, params };
          },
        };
      },
      async batch(statements: unknown[]) {
        batches.push(statements);
        return [
          { meta: { changes: 1 } },
          { meta: { changes: 1 } },
          { meta: { changes: 1 } },
        ];
      },
    } as unknown as D1Database;

    await expect(undoOutboundFollow(database, outboundUndoInput)).resolves.toBe(
      true,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });
});
