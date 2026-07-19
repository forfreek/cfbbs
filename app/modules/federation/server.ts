import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";
import {
  createFederationBuilder,
  type Federation,
  type InboxContext,
} from "@fedify/fedify";
import {
  Accept,
  Create,
  CryptographicKey,
  Delete,
  Follow,
  Like,
  Note,
  Person,
  PUBLIC_COLLECTION,
  Reject,
  Undo,
  Update,
} from "@fedify/vocab";

import {
  acceptRemoteFollow,
  type RemoteFollower,
  settleOutboundFollow,
  undoRemoteFollow,
} from "./follows";
import {
  claimInboxActivity,
  completeInboxActivity,
  rejectInboxActivity,
  releaseInboxActivity,
  validateInboxActivity,
} from "./inbox";
import {
  exportFederationPublicKeyPem,
  importFederationPrivateKey,
  importFederationPublicKey,
} from "./keys";
import { recordRemoteLike, undoRemoteLike } from "./likes";
import { isRemoteActorQuarantined } from "@/modules/moderation/remote-quarantine";
import { isSafeRemoteUrl } from "./remote-url";
import {
  deleteRemoteNote,
  storeRemoteNote,
  storeRemoteThreadReply,
} from "./remote-note";

export type FederationEnvironment = Pick<
  Env,
  "APP_ORIGIN" | "DB" | "FEDERATION_QUEUE" | "FEDIFY_KV"
> & {
  FEDERATION_KEY_ENCRYPTION_SECRET?: string;
};

type LocalActor = { id: string; handle: string };
type LocalActorProfile = LocalActor & {
  displayName: string;
  bio: string;
  publicKeyPem: string;
  encryptedPrivateKey: string | null;
};
type InstancePolicy = { state: "allowed" | "blocked" | "limited" };
type ExistingRemoteActor = { blockedAt: string | null };
type KnownRemoteActor = { id: string };
type LocalReplyTarget = {
  postId: string;
  threadId: string;
  isLocked: number;
};
type ExistingRemoteNote = {
  postId: string | null;
  threadId: string | null;
  parentPostId: string | null;
};
type LocalLikeTarget = {
  postId: string;
  threadId: string;
  authorUserId: string;
};

class RejectedInboundActivity extends Error {}

function actorName(value: unknown) {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
  ) {
    return value.value;
  }
  return "";
}

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
  ) {
    return value.value;
  }
  return "";
}

function instantValue(value: unknown) {
  if (!value) return null;
  const timestamp = String(value);
  if (Number.isNaN(new Date(timestamp).getTime())) return null;
  return new Date(timestamp).toISOString();
}

function isPublicNote(note: Note) {
  const audience = [...note.toIds, ...note.ccIds];
  return (
    audience.some((recipient) => recipient.href === PUBLIC_COLLECTION.href) &&
    note.btoIds.length === 0 &&
    note.bccIds.length === 0
  );
}

async function loadLocalActor(
  database: D1Database,
  handle: string,
): Promise<LocalActor | null> {
  return database
    .prepare(
      "SELECT federation_actors.id, profiles.handle FROM federation_actors INNER JOIN profiles ON profiles.user_id = federation_actors.id WHERE federation_actors.is_local = 1 AND profiles.handle = ? LIMIT 1",
    )
    .bind(handle)
    .first<LocalActor>();
}

async function loadLocalActorProfile(
  database: D1Database,
  handle: string,
): Promise<LocalActorProfile | null> {
  return database
    .prepare(
      "SELECT federation_actors.id, profiles.handle, profiles.display_name AS displayName, profiles.bio, federation_actors.public_key_pem AS publicKeyPem, profiles.federation_private_key_encrypted AS encryptedPrivateKey FROM federation_actors INNER JOIN profiles ON profiles.user_id = federation_actors.id WHERE federation_actors.is_local = 1 AND profiles.handle = ? LIMIT 1",
    )
    .bind(handle)
    .first<LocalActorProfile>();
}

function federationEncryptionSecret(environment: FederationEnvironment) {
  const secret = environment.FEDERATION_KEY_ENCRYPTION_SECRET?.trim();
  if (!secret) {
    throw new Error("FEDERATION_KEY_ENCRYPTION_SECRET must be configured.");
  }
  return secret;
}

async function isBlockedRemoteActor(database: D1Database, actorUri: string) {
  const domain = new URL(actorUri).hostname.toLowerCase();
  const [policy, actor, quarantined] = await Promise.all([
    database
      .prepare("SELECT state FROM instance_policies WHERE domain = ? LIMIT 1")
      .bind(domain)
      .first<InstancePolicy>(),
    database
      .prepare(
        "SELECT blocked_at AS blockedAt FROM federation_actors WHERE uri = ? AND is_local = 0 LIMIT 1",
      )
      .bind(actorUri)
      .first<ExistingRemoteActor>(),
    isRemoteActorQuarantined(database, actorUri),
  ]);
  return policy?.state === "blocked" || actor?.blockedAt != null || quarantined;
}

async function loadFollowedRemoteActor(
  database: D1Database,
  localActorId: string,
  actorUri: string,
) {
  return database
    .prepare(
      "SELECT federation_actors.id AS id FROM federation_follows INNER JOIN federation_actors ON federation_actors.id = federation_follows.following_actor_id WHERE federation_follows.follower_actor_id = ? AND federation_actors.uri = ? AND federation_actors.is_local = 0 AND federation_actors.blocked_at IS NULL AND federation_follows.state = 'accepted' LIMIT 1",
    )
    .bind(localActorId, actorUri)
    .first<KnownRemoteActor>();
}

async function loadKnownRemoteActor(database: D1Database, actorUri: string) {
  return database
    .prepare(
      "SELECT id FROM federation_actors WHERE uri = ? AND is_local = 0 AND blocked_at IS NULL LIMIT 1",
    )
    .bind(actorUri)
    .first<KnownRemoteActor>();
}

async function loadLocalReplyTarget(
  database: D1Database,
  federationObjectId: string,
) {
  return database
    .prepare(
      "SELECT posts.id AS postId, posts.thread_id AS threadId, threads.is_locked AS isLocked FROM posts INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE posts.federation_object_id = ? AND posts.origin = 'local' AND posts.state = 'published' AND posts.visibility = 'public' AND boards.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM board_closure AS path INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id WHERE path.descendant_id = boards.id AND ancestor.visibility != 'public') LIMIT 1",
    )
    .bind(federationObjectId)
    .first<LocalReplyTarget>();
}

async function loadExistingRemoteNote(
  database: D1Database,
  uri: string,
  actorUri: string,
) {
  return database
    .prepare(
      "SELECT posts.id AS postId, posts.thread_id AS threadId, posts.parent_post_id AS parentPostId FROM federation_objects LEFT JOIN posts ON posts.federation_object_id = federation_objects.uri WHERE federation_objects.uri = ? AND federation_objects.actor_id = ? AND federation_objects.type = 'Note' AND federation_objects.deleted_at IS NULL LIMIT 1",
    )
    .bind(uri, actorUri)
    .first<ExistingRemoteNote>();
}

async function loadLocalLikeTarget(
  database: D1Database,
  federationObjectId: string,
) {
  return database
    .prepare(
      "SELECT posts.id AS postId, posts.thread_id AS threadId, posts.author_user_id AS authorUserId FROM posts INNER JOIN threads ON threads.id = posts.thread_id INNER JOIN boards ON boards.id = threads.board_id WHERE posts.federation_object_id = ? AND posts.origin = 'local' AND posts.state = 'published' AND posts.visibility = 'public' AND boards.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM board_closure AS path INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id WHERE path.descendant_id = boards.id AND ancestor.visibility != 'public') LIMIT 1",
    )
    .bind(federationObjectId)
    .first<LocalLikeTarget>();
}

async function resolveRemoteFollower(
  context: InboxContext<FederationEnvironment>,
  follow: Follow,
): Promise<RemoteFollower> {
  const activityActorUri = follow.actorId?.href;
  const remoteActor = await follow.getActor(context);
  if (
    !activityActorUri ||
    !remoteActor?.id ||
    remoteActor.id.href !== activityActorUri
  ) {
    throw new RejectedInboundActivity(
      "Follow actor does not match its resolved actor document.",
    );
  }
  const inboxUrl = remoteActor.inboxId?.href;
  if (!inboxUrl) {
    throw new RejectedInboundActivity("Follow actor has no inbox.");
  }
  const key = await remoteActor.getPublicKey(context);
  if (!key?.publicKey) {
    throw new RejectedInboundActivity("Follow actor has no usable public key.");
  }
  return {
    uri: activityActorUri,
    inboxUrl,
    sharedInboxUrl: remoteActor.endpoints?.sharedInbox?.href ?? null,
    publicKeyPem: await exportFederationPublicKeyPem(key.publicKey),
    name: actorName(remoteActor.name),
  };
}

export async function processInboundFollow(
  context: InboxContext<FederationEnvironment>,
  follow: Follow,
) {
  const activityId = follow.id?.href;
  const actorUri = follow.actorId?.href;
  const recipient = context.recipient;
  if (!activityId || !actorUri || !recipient) return;
  if (!validateInboxActivity({ activityId, actorUri }).ok) return;

  const localActor = await loadLocalActor(context.data.DB, recipient);
  if (!localActor) return;
  const expectedObject = new URL(
    `/users/${localActor.handle}`,
    context.data.APP_ORIGIN,
  ).href;
  if (follow.objectId?.href !== expectedObject) return;

  const claimed = await claimInboxActivity(context.data.DB, {
    activityId,
    actorUri,
  });
  if (!claimed) return;

  try {
    if (await isBlockedRemoteActor(context.data.DB, actorUri)) {
      throw new RejectedInboundActivity("Remote actor or instance is blocked.");
    }
    const follower = await resolveRemoteFollower(context, follow);
    await acceptRemoteFollow(context.data.DB, {
      eventId: crypto.randomUUID(),
      followActivityId: activityId,
      localActorId: localActor.id,
      localHandle: localActor.handle,
      origin: context.data.APP_ORIGIN,
      follower,
    });
    await completeInboxActivity(context.data.DB, activityId);
  } catch (error) {
    if (error instanceof RejectedInboundActivity) {
      await rejectInboxActivity(context.data.DB, activityId, error.message);
      return;
    }
    await releaseInboxActivity(context.data.DB, activityId);
    throw error;
  }
}

export async function processInboundUndo(
  context: InboxContext<FederationEnvironment>,
  undo: Undo,
) {
  const activityId = undo.id?.href;
  const actorUri = undo.actorId?.href;
  const followActivityId = undo.objectId?.href;
  const recipient = context.recipient;
  if (!activityId || !actorUri || !followActivityId || !recipient) return;
  if (!validateInboxActivity({ activityId, actorUri }).ok) return;
  if (!validateInboxActivity({ activityId: followActivityId, actorUri }).ok) {
    return;
  }

  const localActor = await loadLocalActor(context.data.DB, recipient);
  if (!localActor) return;
  const claimed = await claimInboxActivity(context.data.DB, {
    activityId,
    actorUri,
  });
  if (!claimed) return;

  try {
    if (await isBlockedRemoteActor(context.data.DB, actorUri)) {
      throw new RejectedInboundActivity("Remote actor or instance is blocked.");
    }
    const undoneFollow = await undoRemoteFollow(context.data.DB, {
      followActivityId,
      followerActorUri: actorUri,
      localActorId: localActor.id,
    });
    if (!undoneFollow) {
      const undoneLike = await undoRemoteLike(context.data.DB, {
        activityId: followActivityId,
        actorUri,
      });
      if (!undoneLike) {
        throw new RejectedInboundActivity(
          "Follow relationship or Like activity is not active.",
        );
      }
    }
    await completeInboxActivity(context.data.DB, activityId);
  } catch (error) {
    if (error instanceof RejectedInboundActivity) {
      await rejectInboxActivity(context.data.DB, activityId, error.message);
      return;
    }
    await releaseInboxActivity(context.data.DB, activityId);
    throw error;
  }
}

export async function processInboundLike(
  context: InboxContext<FederationEnvironment>,
  like: Like,
) {
  const activityId = like.id?.href;
  const actorUri = like.actorId?.href;
  const objectUri = like.objectId?.href;
  const recipient = context.recipient;
  if (!activityId || !actorUri || !objectUri || !recipient) return;
  if (!validateInboxActivity({ activityId, actorUri }).ok) return;

  const localActor = await loadLocalActor(context.data.DB, recipient);
  if (!localActor) return;
  const claimed = await claimInboxActivity(context.data.DB, {
    activityId,
    actorUri,
  });
  if (!claimed) return;

  try {
    if (await isBlockedRemoteActor(context.data.DB, actorUri)) {
      throw new RejectedInboundActivity("Remote actor or instance is blocked.");
    }
    if (new URL(objectUri).origin !== new URL(context.data.APP_ORIGIN).origin) {
      throw new RejectedInboundActivity("Like must target this instance.");
    }
    const target = await loadLocalLikeTarget(context.data.DB, objectUri);
    if (!target || target.authorUserId !== localActor.id) {
      throw new RejectedInboundActivity(
        "Like does not target this inbox owner.",
      );
    }
    await recordRemoteLike(context.data.DB, {
      activityId,
      actorUri,
      postId: target.postId,
      threadId: target.threadId,
      recipientUserId: target.authorUserId,
    });
    await completeInboxActivity(context.data.DB, activityId);
  } catch (error) {
    if (error instanceof RejectedInboundActivity) {
      await rejectInboxActivity(context.data.DB, activityId, error.message);
      return;
    }
    await releaseInboxActivity(context.data.DB, activityId);
    throw error;
  }
}

async function processInboundFollowOutcome(
  context: InboxContext<FederationEnvironment>,
  activity: Accept | Reject,
  state: "accepted" | "rejected",
) {
  const activityId = activity.id?.href;
  const actorUri = activity.actorId?.href;
  const followActivityId = activity.objectId?.href;
  const recipient = context.recipient;
  if (!activityId || !actorUri || !followActivityId || !recipient) return;
  if (!validateInboxActivity({ activityId, actorUri }).ok) return;
  if (!validateInboxActivity({ activityId: followActivityId, actorUri }).ok) {
    return;
  }

  const localActor = await loadLocalActor(context.data.DB, recipient);
  if (!localActor) return;
  const claimed = await claimInboxActivity(context.data.DB, {
    activityId,
    actorUri,
  });
  if (!claimed) return;

  try {
    if (await isBlockedRemoteActor(context.data.DB, actorUri)) {
      throw new RejectedInboundActivity("Remote actor or instance is blocked.");
    }
    if (
      !(await settleOutboundFollow(context.data.DB, {
        followActivityId,
        localActorId: localActor.id,
        remoteActorUri: actorUri,
        state,
      }))
    ) {
      throw new RejectedInboundActivity("Follow relationship is not pending.");
    }
    await completeInboxActivity(context.data.DB, activityId);
  } catch (error) {
    if (error instanceof RejectedInboundActivity) {
      await rejectInboxActivity(context.data.DB, activityId, error.message);
      return;
    }
    await releaseInboxActivity(context.data.DB, activityId);
    throw error;
  }
}

export function processInboundFollowAccept(
  context: InboxContext<FederationEnvironment>,
  accept: Accept,
) {
  return processInboundFollowOutcome(context, accept, "accepted");
}

export function processInboundFollowReject(
  context: InboxContext<FederationEnvironment>,
  reject: Reject,
) {
  return processInboundFollowOutcome(context, reject, "rejected");
}

async function processInboundRemoteNoteActivity(
  context: InboxContext<FederationEnvironment>,
  activity: Create | Update,
  mode: "create" | "update",
) {
  const activityId = activity.id?.href;
  const actorUri = activity.actorId?.href;
  const recipient = context.recipient;
  if (!activityId || !actorUri || !recipient) return;
  if (!validateInboxActivity({ activityId, actorUri }).ok) return;

  const localActor = await loadLocalActor(context.data.DB, recipient);
  if (!localActor) return;
  const claimed = await claimInboxActivity(context.data.DB, {
    activityId,
    actorUri,
  });
  if (!claimed) return;

  try {
    if (await isBlockedRemoteActor(context.data.DB, actorUri)) {
      throw new RejectedInboundActivity("Remote actor or instance is blocked.");
    }
    if (!(await loadKnownRemoteActor(context.data.DB, actorUri))) {
      throw new RejectedInboundActivity("Remote actor is unknown.");
    }
    const note = await activity.getObject(context);
    const noteUri = note?.id?.href;
    if (
      !(note instanceof Note) ||
      !noteUri ||
      !isSafeRemoteUrl(noteUri) ||
      note.attributionId?.href !== actorUri
    ) {
      throw new RejectedInboundActivity(
        "Activity must contain a Note attributed to its actor.",
      );
    }
    if (new URL(noteUri).origin !== new URL(actorUri).origin) {
      throw new RejectedInboundActivity("Note must be hosted by its actor.");
    }
    if (!isPublicNote(note)) {
      throw new RejectedInboundActivity("Only public Notes are supported.");
    }
    const contentHtml = textValue(note.content);
    if (!contentHtml) {
      throw new RejectedInboundActivity("Note content is required.");
    }
    const remoteNote = {
      uri: noteUri,
      actorUri,
      inReplyToUri: note.replyTargetId?.href ?? null,
      contentHtml,
      publishedAt: instantValue(note.published) ?? new Date().toISOString(),
      updatedAt: instantValue(note.updated),
    };
    const existing = await loadExistingRemoteNote(
      context.data.DB,
      noteUri,
      actorUri,
    );

    if (mode === "update") {
      if (!existing) {
        throw new RejectedInboundActivity("Remote Note does not exist.");
      }
      if (existing.postId && existing.threadId && existing.parentPostId) {
        await storeRemoteThreadReply(context.data.DB, {
          ...remoteNote,
          postId: existing.postId,
          threadId: existing.threadId,
          parentPostId: existing.parentPostId,
        });
      } else {
        await storeRemoteNote(context.data.DB, remoteNote);
      }
    } else {
      const replyTarget = remoteNote.inReplyToUri
        ? await loadLocalReplyTarget(context.data.DB, remoteNote.inReplyToUri)
        : null;
      const isLocalReply =
        remoteNote.inReplyToUri !== null &&
        new URL(remoteNote.inReplyToUri).origin ===
          new URL(context.data.APP_ORIGIN).origin;
      if (isLocalReply && !replyTarget) {
        throw new RejectedInboundActivity(
          "Reply target is not a public local post.",
        );
      }
      if (replyTarget) {
        if (replyTarget.isLocked) {
          throw new RejectedInboundActivity("Thread is locked.");
        }
        await storeRemoteThreadReply(context.data.DB, {
          ...remoteNote,
          postId: existing?.postId ?? crypto.randomUUID(),
          threadId: existing?.threadId ?? replyTarget.threadId,
          parentPostId: existing?.parentPostId ?? replyTarget.postId,
        });
      } else {
        if (
          !(await loadFollowedRemoteActor(
            context.data.DB,
            localActor.id,
            actorUri,
          ))
        ) {
          throw new RejectedInboundActivity("Remote actor is not followed.");
        }
        await storeRemoteNote(context.data.DB, remoteNote);
      }
    }
    await completeInboxActivity(context.data.DB, activityId);
  } catch (error) {
    if (error instanceof RejectedInboundActivity) {
      await rejectInboxActivity(context.data.DB, activityId, error.message);
      return;
    }
    await releaseInboxActivity(context.data.DB, activityId);
    throw error;
  }
}

export function processInboundCreate(
  context: InboxContext<FederationEnvironment>,
  create: Create,
) {
  return processInboundRemoteNoteActivity(context, create, "create");
}

export function processInboundUpdate(
  context: InboxContext<FederationEnvironment>,
  update: Update,
) {
  return processInboundRemoteNoteActivity(context, update, "update");
}

export async function processInboundDelete(
  context: InboxContext<FederationEnvironment>,
  activity: Delete,
) {
  const activityId = activity.id?.href;
  const actorUri = activity.actorId?.href;
  const objectUri = activity.objectId?.href;
  const recipient = context.recipient;
  if (!activityId || !actorUri || !objectUri || !recipient) return;
  if (!validateInboxActivity({ activityId, actorUri }).ok) return;
  if (!isSafeRemoteUrl(objectUri)) return;

  const localActor = await loadLocalActor(context.data.DB, recipient);
  if (!localActor) return;
  const claimed = await claimInboxActivity(context.data.DB, {
    activityId,
    actorUri,
  });
  if (!claimed) return;

  try {
    if (await isBlockedRemoteActor(context.data.DB, actorUri)) {
      throw new RejectedInboundActivity("Remote actor or instance is blocked.");
    }
    if (new URL(objectUri).origin !== new URL(actorUri).origin) {
      throw new RejectedInboundActivity("Note must be hosted by its actor.");
    }
    if (
      !(await deleteRemoteNote(context.data.DB, {
        uri: objectUri,
        actorUri,
      }))
    ) {
      throw new RejectedInboundActivity("Remote Note does not exist.");
    }
    await completeInboxActivity(context.data.DB, activityId);
  } catch (error) {
    if (error instanceof RejectedInboundActivity) {
      await rejectInboxActivity(context.data.DB, activityId, error.message);
      return;
    }
    await releaseInboxActivity(context.data.DB, activityId);
    throw error;
  }
}

const builder = createFederationBuilder<FederationEnvironment>();

builder
  .setActorDispatcher("/users/{identifier}", async (context, identifier) => {
    const actor = await loadLocalActorProfile(context.data.DB, identifier);
    if (!actor) return null;
    const actorUri = context.getActorUri(identifier);
    const publicKey = await importFederationPublicKey(actor.publicKeyPem);
    return new Person({
      id: actorUri,
      preferredUsername: actor.handle,
      name: actor.displayName,
      summary: actor.bio,
      inbox: context.getInboxUri(identifier),
      outbox: new URL(`/users/${actor.handle}/outbox`, context.canonicalOrigin),
      followers: new URL(
        `/users/${actor.handle}/followers`,
        context.canonicalOrigin,
      ),
      following: new URL(
        `/users/${actor.handle}/following`,
        context.canonicalOrigin,
      ),
      publicKey: new CryptographicKey({
        id: new URL("#main-key", actorUri),
        owner: actorUri,
        publicKey,
      }),
    });
  })
  .setKeyPairsDispatcher(async (context, identifier) => {
    const actor = await loadLocalActorProfile(context.data.DB, identifier);
    if (!actor?.encryptedPrivateKey) return [];
    const secret = federationEncryptionSecret(context.data);
    const [publicKey, privateKey] = await Promise.all([
      importFederationPublicKey(actor.publicKeyPem),
      importFederationPrivateKey(actor.encryptedPrivateKey, secret),
    ]);
    return [{ publicKey, privateKey }];
  });

builder
  .setInboxListeners("/users/{identifier}/inbox")
  .withIdempotency("global")
  .on(Follow, processInboundFollow)
  .on(Undo, processInboundUndo)
  .on(Accept, processInboundFollowAccept)
  .on(Reject, processInboundFollowReject)
  .on(Create, processInboundCreate)
  .on(Update, processInboundUpdate)
  .on(Delete, processInboundDelete)
  .on(Like, processInboundLike);

export async function createWorkerFederation(
  environment: FederationEnvironment,
): Promise<Federation<FederationEnvironment>> {
  return builder.build({
    kv: new WorkersKvStore(environment.FEDIFY_KV),
    queue: new WorkersMessageQueue(environment.FEDERATION_QUEUE, {
      orderingKv: environment.FEDIFY_KV,
    }),
    manuallyStartQueue: true,
    origin: environment.APP_ORIGIN,
    inboxChallengePolicy: { enabled: true, requestNonce: true },
  });
}

export function isFedifyQueueMessage(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value.type === "fanout" ||
      value.type === "inbox" ||
      value.type === "outbox")
  );
}
