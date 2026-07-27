import { createRequestHandler } from "react-router";

import { createWorkerFederation } from "@/modules/federation/server";
import { handlePublicActorCollectionActivity } from "@/modules/federation/collections";
import { handlePublicNoteActivity } from "@/modules/federation/object";
import { processFederationQueue } from "@/modules/jobs/federation-queue";
import { enqueuePendingOutboxEvents } from "@/modules/jobs/federation-outbox";
import { purgeExpiredRemoteObjects } from "@/modules/jobs/remote-retention";
import { scheduledWork } from "@/modules/jobs/scheduled";
import { purgeExpiredRemoteActorQuarantines } from "@/modules/moderation/remote-quarantine";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

async function recordTestFederationFailure(env: Env, error: unknown) {
  if (env.FEDIFY_ALLOW_PRIVATE_ADDRESS !== "true") return;

  const exception = error instanceof Error ? error : new Error(String(error));
  await env.FEDIFY_KV.put(
    "cfbbs:test:last-federation-fetch-failure",
    JSON.stringify({
      at: new Date().toISOString(),
      name: exception.name,
      message: exception.message,
      stack: exception.stack?.slice(0, 8_000) ?? null,
    }),
    { expirationTtl: 600 },
  );
}

async function recordTestInboundRequest(env: Env, request: Request) {
  if (
    env.FEDIFY_ALLOW_PRIVATE_ADDRESS !== "true" ||
    !request.url.includes("/inbox")
  ) {
    return;
  }
  const metadata = {
    at: new Date().toISOString(),
    date: request.headers.get("date"),
    hasDigest: request.headers.has("digest"),
    hasSignature: request.headers.has("signature"),
    contentType: request.headers.get("content-type"),
  };
  // Awaiting this test-only write proves that the request reached the Worker;
  // the log lets Tail observe the same non-sensitive metadata if KV tracing
  // itself is unavailable.
  await env.FEDIFY_KV.put(
    "cfbbs:test:inbound-request-metadata",
    JSON.stringify(metadata),
    { expirationTtl: 600 },
  );
  console.log("CFBBS inbound ActivityPub request", metadata);
}

export default {
  async fetch(request, env, ctx) {
    await recordTestInboundRequest(env, request);
    const collectionResponse = await handlePublicActorCollectionActivity(
      request,
      env.DB,
      env.APP_ORIGIN,
    );
    if (collectionResponse) return collectionResponse;

    const noteResponse = await handlePublicNoteActivity(
      request,
      env.DB,
      env.APP_ORIGIN,
    );
    if (noteResponse) return noteResponse;

    const federation = await createWorkerFederation(env);
    try {
      return await federation.fetch(request, {
        contextData: env,
        onNotFound: (unmatchedRequest) =>
          requestHandler(unmatchedRequest, {
            cloudflare: { env, ctx },
          }),
        onNotAcceptable: (unacceptableRequest) =>
          requestHandler(unacceptableRequest, {
            cloudflare: { env, ctx },
          }),
      });
    } catch (error) {
      ctx.waitUntil(recordTestFederationFailure(env, error));
      throw error;
    }
  },
  async queue(batch, env) {
    await processFederationQueue(batch, env);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(
      Promise.all(
        scheduledWork(
          controller.cron,
          () => enqueuePendingOutboxEvents(env.DB, env.FEDERATION_QUEUE),
          [
            () => purgeExpiredRemoteObjects(env.DB),
            () => purgeExpiredRemoteActorQuarantines(env.DB),
          ],
        ),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
