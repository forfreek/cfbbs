import {
  deliverOutboxEvent,
  type OutboxDeliverySummary,
} from "./federation-delivery";
import { isOutboxQueueMessage } from "./federation-outbox";

type QueueMessage = Pick<Message<unknown>, "body" | "ack" | "retry">;
type QueueBatch = Pick<MessageBatch<unknown>, "messages">;

export type FederationQueueEnvironment = {
  DB: D1Database;
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
  const encryptionSecret = getEncryptionSecret(environment);

  await Promise.all(
    batch.messages.map(async (message: QueueMessage) => {
      if (!isOutboxQueueMessage(message.body)) {
        message.ack();
        return;
      }

      try {
        await deliver(environment.DB, {
          eventId: message.body.outboxEventId,
          encryptionSecret,
        });
        message.ack();
      } catch {
        message.retry();
      }
    }),
  );
}
