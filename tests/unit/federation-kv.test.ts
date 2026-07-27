import { describe, expect, it } from "vitest";
import type { KvKey, KvStore, KvStoreListEntry } from "@fedify/fedify";

import {
  SkipUndoActivityIdempotenceKvStore,
  isUndoActivityIdempotenceKey,
} from "@/modules/federation/kv";

class MemoryStore implements KvStore {
  readonly values = new Map<string, unknown>();

  #encode(key: KvKey) {
    return JSON.stringify(key);
  }

  async get<T = unknown>(key: KvKey) {
    return this.values.get(this.#encode(key)) as T | undefined;
  }

  async set(key: KvKey, value: unknown) {
    this.values.set(this.#encode(key), value);
  }

  async delete(key: KvKey) {
    this.values.delete(this.#encode(key));
  }

  async *list(prefix?: KvKey): AsyncIterable<KvStoreListEntry> {
    const encodedPrefix = prefix ? JSON.stringify(prefix).slice(0, -1) : null;
    for (const [encoded, value] of this.values.entries()) {
      if (encodedPrefix && !encoded.startsWith(encodedPrefix)) continue;
      yield { key: JSON.parse(encoded) as KvKey, value };
    }
  }
}

describe("SkipUndoActivityIdempotenceKvStore", () => {
  it("detects both HTTP and queue Undo idempotence keys", () => {
    expect(
      isUndoActivityIdempotenceKey([
        "_fedify",
        "activityIdempotence",
        "https://misskey.example/follows/a/b/undo",
      ]),
    ).toBe(true);
    expect(
      isUndoActivityIdempotenceKey([
        "_fedify",
        "activityIdempotence",
        "https://bbs.example",
        "https://misskey.example/follows/a/b/undo",
      ]),
    ).toBe(true);
    expect(
      isUndoActivityIdempotenceKey([
        "_fedify",
        "activityIdempotence",
        "https://misskey.example/follows/1",
      ]),
    ).toBe(false);
  });

  it("ignores get/set for Undo activityIdempotence keys", async () => {
    const memory = new MemoryStore();
    const store = new SkipUndoActivityIdempotenceKvStore(memory);
    const undoKey = [
      "_fedify",
      "activityIdempotence",
      "https://bbs.example",
      "https://misskey.example/follows/a/b/undo",
    ] as KvKey;
    const followKey = [
      "_fedify",
      "activityIdempotence",
      "https://bbs.example",
      "https://misskey.example/follows/1",
    ] as KvKey;

    await store.set(undoKey, true);
    await store.set(followKey, true);

    await expect(store.get(undoKey)).resolves.toBeUndefined();
    await expect(store.get(followKey)).resolves.toBe(true);
    expect([...memory.values.keys()]).toEqual([JSON.stringify(followKey)]);
  });
});
