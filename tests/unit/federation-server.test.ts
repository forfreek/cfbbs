import { describe, expect, it } from "vitest";
import {
  Accept,
  Create,
  Delete,
  Follow,
  Like,
  Note,
  PUBLIC_COLLECTION,
  Reject,
  Undo,
  Update,
} from "@fedify/vocab";

import {
  generateFederationSigningKeyPair,
  importFederationPublicKey,
} from "@/modules/federation/keys";
import {
  createWorkerFederation,
  processInboundFollowAccept,
  processInboundCreate,
  processInboundDelete,
  processInboundFollow,
  processInboundFollowReject,
  processInboundLike,
  processInboundUndo,
  processInboundUpdate,
} from "@/modules/federation/server";

function federationEnvironment() {
  const values = new Map<string, string>();
  const pairPromise = generateFederationSigningKeyPair("encryption-secret");
  return {
    environment: {
      APP_ORIGIN: "https://bbs.example.test",
      FEDERATION_KEY_ENCRYPTION_SECRET: "encryption-secret",
      DB: {
        prepare(sql: string) {
          return {
            bind() {
              return {
                first: async () => {
                  const pair = await pairPromise;
                  if (sql.includes("federation_private_key_encrypted")) {
                    return {
                      id: "user-1",
                      handle: "alice",
                      displayName: "Alice",
                      bio: "",
                      publicKeyPem: pair.publicKeyPem,
                      encryptedPrivateKey: pair.privateKeyEncrypted,
                    };
                  }
                  return { id: "user-1", handle: "alice" };
                },
              };
            },
          };
        },
      } as unknown as D1Database,
      FEDIFY_KV: {
        async get(key: string) {
          return values.get(key) ?? null;
        },
        async getWithMetadata(key: string) {
          return { value: values.get(key) ?? null, metadata: null };
        },
        async put(key: string, value: string) {
          values.set(key, value);
        },
        async delete(key: string) {
          values.delete(key);
        },
        async list() {
          return { list_complete: true, keys: [] };
        },
      } as unknown as KVNamespace,
      FEDERATION_QUEUE: {
        async send() {},
        async sendBatch() {},
      } as unknown as Queue,
    },
  };
}

describe("Fedify inbox gateway", () => {
  it("serializes a local Actor with its public signing key", async () => {
    const { environment } = federationEnvironment();
    const federation = await createWorkerFederation(environment);

    const response = await federation.fetch(
      new Request("https://bbs.example.test/users/alice", {
        headers: { accept: "application/activity+json" },
      }),
      { contextData: environment },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "https://bbs.example.test/users/alice",
      type: "Person",
      preferredUsername: "alice",
      inbox: "https://bbs.example.test/users/alice/inbox",
      publicKey: {
        id: "https://bbs.example.test/users/alice#main-key",
        owner: "https://bbs.example.test/users/alice",
      },
    });
  });

  it("rejects an unsigned Follow before it reaches forum state", async () => {
    const { environment } = federationEnvironment();
    const federation = await createWorkerFederation(environment);

    const response = await federation.fetch(
      new Request("https://bbs.example.test/users/alice/inbox", {
        method: "POST",
        headers: {
          accept: "application/activity+json",
          "content-type": "application/activity+json",
        },
        body: JSON.stringify({
          "@context": "https://www.w3.org/ns/activitystreams",
          id: "https://remote.example/activities/follow-1",
          type: "Follow",
          actor: "https://remote.example/users/bob",
          object: "https://bbs.example.test/users/alice",
        }),
      }),
      { contextData: environment },
    );

    expect(response.status).toBe(401);
  });

  it("accepts a verified Follow into an atomic direct Accept delivery", async () => {
    const localPair =
      await generateFederationSigningKeyPair("encryption-secret");
    const remotePair = await generateFederationSigningKeyPair(
      "remote-encryption-secret",
    );
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            const statement = { sql, params };
            statements.push(statement);
            if (sql.includes("SELECT federation_actors.id")) {
              return { first: async () => ({ id: "user-1", handle: "alice" }) };
            }
            if (sql.includes("SELECT state FROM instance_policies")) {
              return { first: async () => null };
            }
            if (sql.includes("SELECT blocked_at")) {
              return { first: async () => null };
            }
            return { run: async () => ({ meta: { changes: 1 } }) };
          },
        };
      },
      async batch(batch: unknown[]) {
        batches.push(batch);
        return [];
      },
    } as unknown as D1Database;
    const remotePublicKey = await importFederationPublicKey(
      remotePair.publicKeyPem,
    );
    const follow = {
      id: new URL("https://remote.example/activities/follow-1"),
      actorId: new URL("https://remote.example/users/bob"),
      objectId: new URL("https://bbs.example.test/users/alice"),
      getActor: async () => ({
        id: new URL("https://remote.example/users/bob"),
        inboxId: new URL("https://remote.example/inbox"),
        endpoints: {
          sharedInbox: new URL("https://remote.example/inbox/shared"),
        },
        name: "Bob",
        getPublicKey: async () => ({ publicKey: remotePublicKey }),
      }),
    } as unknown as Follow;

    await processInboundFollow(
      {
        recipient: "alice",
        data: {
          APP_ORIGIN: "https://bbs.example.test",
          FEDERATION_KEY_ENCRYPTION_SECRET: "encryption-secret",
          DB: database,
          FEDIFY_KV: {} as KVNamespace,
          FEDERATION_QUEUE: {} as Queue,
        },
      } as never,
      follow,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(4);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
    expect(localPair.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/);
  });

  it("marks the matching accepted remote Follow as undone", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = inboxDatabase(statements);
    const remoteActor = "https://remote.example/users/bob";
    const undo = new Undo({
      id: new URL("https://remote.example/activities/undo-follow-1"),
      actor: new URL(remoteActor),
      object: new URL("https://remote.example/activities/follow-1"),
    });

    await processInboundUndo(inboxContext(database), undo);

    expect(
      statements.some((statement) =>
        statement.sql.includes(
          "UPDATE federation_follows SET state = 'undone'",
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
  });

  it("rejects an Undo that does not reference an active remote Follow", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = inboxDatabase(statements, {
      followChanges: 0,
      likeChanges: 0,
    });
    const undo = new Undo({
      id: new URL("https://remote.example/activities/undo-follow-1"),
      actor: new URL("https://remote.example/users/bob"),
      object: new URL("https://remote.example/activities/follow-1"),
    });

    await processInboundUndo(inboxContext(database), undo);

    expect(
      statements.some((statement) =>
        statement.sql.includes(
          "UPDATE federation_follows SET state = 'undone'",
        ),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'rejected'"),
      ),
    ).toBe(true);
  });

  it("rejects an Undo from a blocked remote actor", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = inboxDatabase(statements, { blocked: true });
    const remoteActor = "https://remote.example/users/bob";
    const undo = new Undo({
      id: new URL("https://remote.example/activities/undo-follow-1"),
      actor: new URL(remoteActor),
      object: new Follow({
        id: new URL("https://remote.example/activities/follow-1"),
        actor: new URL(remoteActor),
        object: new URL("https://bbs.example.test/users/alice"),
      }),
    });

    await processInboundUndo(inboxContext(database), undo);

    expect(
      statements.some((statement) =>
        statement.sql.includes(
          "UPDATE federation_follows SET state = 'undone'",
        ),
      ),
    ).toBe(false);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'rejected'"),
      ),
    ).toBe(true);
  });

  it("accepts a remote response only for the matching pending outbound Follow", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = inboxDatabase(statements);
    const remoteActor = "https://remote.example/users/bob";
    const accept = new Accept({
      id: new URL("https://remote.example/activities/accept-follow-1"),
      actor: new URL(remoteActor),
      object: new URL("https://bbs.example.test/activities/follow/follow-1"),
    });

    await processInboundFollowAccept(inboxContext(database), accept);

    const update = statements.find((statement) =>
      statement.sql.includes("UPDATE federation_follows SET state = ?"),
    );
    expect(update?.params).toEqual(
      expect.arrayContaining([
        "accepted",
        "https://bbs.example.test/activities/follow/follow-1",
        "user-1",
        remoteActor,
      ]),
    );
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
  });

  it("rejects a remote Reject that does not match a pending outbound Follow", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = inboxDatabase(statements, {
      followChanges: 0,
      likeChanges: 1,
    });
    const reject = new Reject({
      id: new URL("https://remote.example/activities/reject-follow-1"),
      actor: new URL("https://remote.example/users/bob"),
      object: new URL("https://bbs.example.test/activities/follow/follow-1"),
    });

    await processInboundFollowReject(inboxContext(database), reject);

    const update = statements.find((statement) =>
      statement.sql.includes("UPDATE federation_follows SET state = ?"),
    );
    expect(update?.params).toContain("rejected");
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'rejected'"),
      ),
    ).toBe(true);
  });

  it("stores a public Create from an accepted remote follow", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = remoteNoteDatabase(statements, batches);
    const remoteActor = "https://remote.example/users/bob";
    const create = new Create({
      id: new URL("https://remote.example/activities/create-note-1"),
      actor: new URL(remoteActor),
      object: new Note({
        id: new URL("https://remote.example/notes/1"),
        attribution: new URL(remoteActor),
        content: "<p>hello<script>alert(1)</script></p>",
        to: PUBLIC_COLLECTION,
      }),
    });

    await processInboundCreate(inboxContext(database), create);

    expect(batches).toHaveLength(1);
    expect(
      statements.some((statement) =>
        statement.sql.includes("INSERT INTO federation_objects"),
      ),
    ).toBe(true);
    const objectStatement = statements.find((statement) =>
      statement.sql.includes("INSERT INTO federation_objects"),
    );
    expect(objectStatement?.params).toEqual(
      expect.arrayContaining(["<p>hello</p>"]),
    );
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
  });

  it("rejects a non-public remote Create without persisting content", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = remoteNoteDatabase(statements, batches);
    const remoteActor = "https://remote.example/users/bob";
    const create = new Create({
      id: new URL("https://remote.example/activities/create-note-1"),
      actor: new URL(remoteActor),
      object: new Note({
        id: new URL("https://remote.example/notes/1"),
        attribution: new URL(remoteActor),
        content: "not public",
        to: new URL("https://bbs.example.test/users/alice"),
      }),
    });

    await processInboundCreate(inboxContext(database), create);

    expect(batches).toEqual([]);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'rejected'"),
      ),
    ).toBe(true);
  });

  it("adds a known remote actor's public reply to a local public thread", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = remoteNoteDatabase(statements, batches, {
      replyTarget: true,
    });
    const remoteActor = "https://remote.example/users/bob";
    const create = new Create({
      id: new URL("https://remote.example/activities/create-reply-1"),
      actor: new URL(remoteActor),
      object: new Note({
        id: new URL("https://remote.example/notes/reply-1"),
        attribution: new URL(remoteActor),
        content: "A remote reply",
        to: PUBLIC_COLLECTION,
        replyTarget: new URL("https://bbs.example.test/objects/post-1"),
      }),
    });

    await processInboundCreate(inboxContext(database), create);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(
      statements.some(
        (statement) =>
          statement.sql.includes("INSERT INTO posts") &&
          statement.sql.includes("'remote'"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.includes(
          "UPDATE threads SET post_count = post_count + 1",
        ),
      ),
    ).toBe(true);
  });

  it("updates only an existing remote Note owned by the activity actor", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = remoteNoteDatabase(statements, batches, {
      existing: "reply",
    });
    const remoteActor = "https://remote.example/users/bob";
    const update = new Update({
      id: new URL("https://remote.example/activities/update-note-1"),
      actor: new URL(remoteActor),
      object: new Note({
        id: new URL("https://remote.example/notes/reply-1"),
        attribution: new URL(remoteActor),
        content: "An edited remote reply",
        to: PUBLIC_COLLECTION,
      }),
    });

    await processInboundUpdate(inboxContext(database), update);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(
      statements.some((statement) =>
        statement.sql.includes("ON CONFLICT(federation_object_id) DO UPDATE"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.params.includes("An edited remote reply"),
      ),
    ).toBe(true);
  });

  it("soft deletes the matching remote Note and completes its receipt", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = remoteNoteDatabase(statements, batches);
    const activity = new Delete({
      id: new URL("https://remote.example/activities/delete-note-1"),
      actor: new URL("https://remote.example/users/bob"),
      object: new URL("https://remote.example/notes/reply-1"),
    });

    await processInboundDelete(inboxContext(database), activity);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(
      statements.some((statement) =>
        statement.sql.includes("UPDATE federation_objects SET deleted_at"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
  });

  it("records a signed remote Like for its local public target", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const batches: unknown[][] = [];
    const database = remoteNoteDatabase(statements, batches, {
      likeTarget: true,
    });
    const activity = new Like({
      id: new URL("https://remote.example/activities/like-1"),
      actor: new URL("https://remote.example/users/bob"),
      object: new URL("https://bbs.example.test/objects/post-1"),
    });

    await processInboundLike(inboxContext(database), activity);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(
      statements.some((statement) =>
        statement.sql.includes("INSERT OR IGNORE INTO post_likes"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
  });

  it("uses Undo to remove a matching remote Like when no Follow matches", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = inboxDatabase(statements, {
      followChanges: 0,
      likeChanges: 1,
    });
    const undo = new Undo({
      id: new URL("https://remote.example/activities/undo-like-1"),
      actor: new URL("https://remote.example/users/bob"),
      object: new URL("https://remote.example/activities/like-1"),
    });

    await processInboundUndo(inboxContext(database), undo);

    expect(
      statements.some((statement) =>
        statement.sql.includes("DELETE FROM post_likes"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.sql.includes("state = 'processed'"),
      ),
    ).toBe(true);
  });
});

function inboxDatabase(
  statements: Array<{ sql: string; params: unknown[] }>,
  options: {
    blocked?: boolean;
    followChanges?: number;
    likeChanges?: number;
  } = {},
) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          statements.push({ sql, params });
          return {
            first: async () => {
              if (sql.includes("SELECT federation_actors.id")) {
                return { id: "user-1", handle: "alice" };
              }
              if (sql.includes("SELECT state FROM instance_policies")) {
                return options.blocked ? { state: "blocked" } : null;
              }
              if (sql.includes("SELECT blocked_at")) return null;
              return null;
            },
            run: async () => ({
              meta: {
                changes: sql.includes("UPDATE federation_follows")
                  ? (options.followChanges ?? 1)
                  : sql.includes("DELETE FROM post_likes")
                    ? (options.likeChanges ?? 0)
                    : 1,
              },
            }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

function inboxContext(database: D1Database) {
  return {
    recipient: "alice",
    data: {
      APP_ORIGIN: "https://bbs.example.test",
      FEDERATION_KEY_ENCRYPTION_SECRET: "encryption-secret",
      DB: database,
      FEDIFY_KV: {} as KVNamespace,
      FEDERATION_QUEUE: {} as Queue,
    },
  } as never;
}

function remoteNoteDatabase(
  statements: Array<{ sql: string; params: unknown[] }>,
  batches: unknown[][],
  options: {
    existing?: "reply" | "standalone";
    likeTarget?: boolean;
    replyTarget?: boolean;
  } = {},
) {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const statement = { sql, params };
          statements.push(statement);
          return {
            first: async () => {
              if (
                sql.includes("SELECT federation_actors.id, profiles.handle")
              ) {
                return { id: "user-1", handle: "alice" };
              }
              if (sql.includes("SELECT state FROM instance_policies")) {
                return null;
              }
              if (sql.includes("SELECT blocked_at")) return null;
              if (sql.includes("FROM federation_actors WHERE uri")) {
                return { id: "https://remote.example/users/bob" };
              }
              if (sql.includes("FROM federation_objects LEFT JOIN posts")) {
                if (options.existing === "reply") {
                  return {
                    postId: "remote-post-1",
                    threadId: "thread-1",
                    parentPostId: "post-1",
                  };
                }
                return options.existing === "standalone" ? {} : null;
              }
              if (sql.includes("posts.author_user_id AS authorUserId")) {
                return options.likeTarget
                  ? {
                      postId: "post-1",
                      threadId: "thread-1",
                      authorUserId: "user-1",
                    }
                  : null;
              }
              if (sql.includes("SELECT posts.id AS postId")) {
                return options.replyTarget
                  ? { postId: "post-1", threadId: "thread-1", isLocked: 0 }
                  : null;
              }
              if (sql.includes("FROM federation_follows")) {
                return { id: "https://remote.example/users/bob" };
              }
              return null;
            },
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      };
    },
    async batch(batch: unknown[]) {
      batches.push(batch);
      return [
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
        { meta: { changes: 1 } },
      ];
    },
  } as unknown as D1Database;
}
