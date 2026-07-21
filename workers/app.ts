import { createRequestHandler } from "react-router";

import { createWorkerFederation } from "@/modules/federation/server";
import { handlePublicActorCollectionActivity } from "@/modules/federation/collections";
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

export default {
  async fetch(request, env, ctx) {
    const collectionResponse = await handlePublicActorCollectionActivity(
      request,
      env.DB,
      env.APP_ORIGIN,
    );
    if (collectionResponse) return collectionResponse;

    const federation = await createWorkerFederation(env);
    return federation.fetch(request, {
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
