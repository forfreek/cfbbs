import { WorkersKvStore, WorkersMessageQueue } from "@fedify/cfworkers";
import {
  createFederationBuilder,
  type Federation,
  type InboxContext,
} from "@fedify/fedify";
import {
  Accept,
  CryptographicKey,
  Follow,
  Person,
  Reject,
  Undo,
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
  const [policy, actor] = await Promise.all([
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
  ]);
  return policy?.state === "blocked" || actor?.blockedAt != null;
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
    if (
      !(await undoRemoteFollow(context.data.DB, {
        followActivityId,
        followerActorUri: actorUri,
        localActorId: localActor.id,
      }))
    ) {
      throw new RejectedInboundActivity("Follow relationship is not active.");
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
  .on(Reject, processInboundFollowReject);

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
