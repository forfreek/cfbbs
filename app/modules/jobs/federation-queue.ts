import {
  deliverOutboxEvent,
  type OutboxDeliverySummary,
} from "./federation-delivery";
import { isOutboxQueueMessage } from "./federation-outbox";
import {
  createWorkerFederation,
  isFedifyQueueMessage,
  type FederationEnvironment,
} from "@/modules/federation/server";
import { WorkersMessageQueue } from "@fedify/cfworkers";
import type { Message as FedifyMessage } from "@fedify/fedify";

type QueueMessage = Pick<Message<unknown>, "body" | "ack" | "retry">;
type QueueBatch = Pick<MessageBatch<unknown>, "messages">;

export type FederationQueueEnvironment = FederationEnvironment & {
  FEDERATION_KEY_ENCRYPTION_SECRET?: string;
};

export type OutboxEventDelivery = (
  database: D1Database,
  input: { eventId: string; encryptionSecret: string },
) => Promise<OutboxDeliverySummary | null>;

function getEncryptionSecret(environment: FederationQueueEnvironment) {
  const encryptionSecret = environment.FEDERATION_KEY_ENCRYPTION_SECRET?.trim();
  if (!encryptionSecret) {
    throw new Error("FEDERATION_KEY_ENCRYPTION_SECRET must be configured.");
  }
  return encryptionSecret;
}

export async function processFederationQueue(
  batch: QueueBatch,
  environment: FederationQueueEnvironment,
  deliver: OutboxEventDelivery = deliverOutboxEvent,
) {
  const encryptionSecret = batch.messages.some((message) =>
    isOutboxQueueMessage(message.body),
  )
    ? getEncryptionSecret(environment)
    : null;
  let federationPromise: Promise<
    Awaited<ReturnType<typeof createWorkerFederation>>
  > | null = null;
  let fedifyQueue: WorkersMessageQueue | null = null;

  await Promise.all(
    batch.messages.map(async (message: QueueMessage) => {
      if (isOutboxQueueMessage(message.body)) {
        try {
          await deliver(environment.DB, {
            eventId: message.body.outboxEventId,
            encryptionSecret: encryptionSecret as string,
          });
          message.ack();
        } catch {
          message.retry();
        }
        return;
      }
      if (!isFedifyQueueMessage(message.body)) {
        message.ack();
        return;
      }

      federationPromise ??= createWorkerFederation(environment);
      const federation = await federationPromise;
      fedifyQueue ??= new WorkersMessageQueue(environment.FEDERATION_QUEUE, {
        orderingKv: environment.FEDIFY_KV,
      });
      const queued = await fedifyQueue.processMessage(message.body);
      if (!queued.shouldProcess) {
        message.retry();
        return;
      }
      try {
        await federation.processQueuedTask(
          environment,
          queued.message as FedifyMessage,
        );
        message.ack();
      } catch {
        message.retry();
      } finally {
        await queued.release?.();
      }
    }),
  );
}
