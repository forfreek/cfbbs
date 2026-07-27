import { WorkersKvStore } from "@fedify/cfworkers";
import type {
  KvKey,
  KvStore,
  KvStoreListEntry,
  KvStoreSetOptions,
} from "@fedify/fedify";

const ACTIVITY_IDEMPOTENCE_PREFIX = ["_fedify", "activityIdempotence"] as const;

export function isUndoActivityIdempotenceKey(key: KvKey) {
  if (key.length < ACTIVITY_IDEMPOTENCE_PREFIX.length + 1) return false;
  if (
    key[0] !== ACTIVITY_IDEMPOTENCE_PREFIX[0] ||
    key[1] !== ACTIVITY_IDEMPOTENCE_PREFIX[1]
  ) {
    return false;
  }

  // HTTP strategy keys end with the activity id string.
  // Queue consumer keys are [prefix..., origin, activityId].
  const activityId = key[key.length - 1];
  return (
    typeof activityId === "string" && activityId.toLowerCase().includes("/undo")
  );
}

// Fedify's queue consumer hardcodes activityIdempotence keys and ignores
// custom withIdempotency strategies. Misskey reuses a stable Undo Follow id,
// so later unfollows must not be treated as already processed.
export class SkipUndoActivityIdempotenceKvStore implements KvStore {
  readonly #store: KvStore;

  constructor(store: KvStore) {
    this.#store = store;
  }

  get<T = unknown>(key: KvKey): Promise<T | undefined> {
    if (isUndoActivityIdempotenceKey(key)) {
      return Promise.resolve(undefined);
    }
    return this.#store.get<T>(key);
  }

  set(key: KvKey, value: unknown, options?: KvStoreSetOptions): Promise<void> {
    if (isUndoActivityIdempotenceKey(key)) {
      return Promise.resolve();
    }
    return this.#store.set(key, value, options);
  }

  delete(key: KvKey): Promise<void> {
    return this.#store.delete(key);
  }

  cas?(
    key: KvKey,
    expectedValue: unknown,
    newValue: unknown,
    options?: KvStoreSetOptions,
  ): Promise<boolean> {
    if (!this.#store.cas) {
      return Promise.resolve(false);
    }
    if (isUndoActivityIdempotenceKey(key)) {
      return Promise.resolve(true);
    }
    return this.#store.cas(key, expectedValue, newValue, options);
  }

  list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    return this.#store.list(prefix);
  }
}

export function createFederationKvStore(namespace: KVNamespace): KvStore {
  return new SkipUndoActivityIdempotenceKvStore(new WorkersKvStore(namespace));
}
