import { createRequestHandler } from "react-router";

import { createWorkerFederation } from "@/modules/federation/server";
import { processFederationQueue } from "@/modules/jobs/federation-queue";
import { enqueuePendingOutboxEvents } from "@/modules/jobs/federation-outbox";

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
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(enqueuePendingOutboxEvents(env.DB, env.FEDERATION_QUEUE));
  },
} satisfies ExportedHandler<Env>;
