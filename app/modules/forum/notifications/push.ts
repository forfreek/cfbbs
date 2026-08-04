type PushEnvironment = {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
};

type PushSubscriptionRecord = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type PushDeliveryRecord = PushSubscriptionRecord & {
  deliveryId: string;
};

type NotificationPushRow = {
  outboxId: string;
  notificationId: string;
  type: "reply" | "follow" | "like" | "mention" | "thread-reply";
  recipientUserId: string;
  actorName: string | null;
  threadId: string | null;
  postId: string | null;
};

const encoder = new TextEncoder();

function base64UrlEncode(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function concatBytes(...parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

async function hmac(keyBytes: Uint8Array, data: Uint8Array) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, data as unknown as BufferSource),
  );
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  const output: Uint8Array[] = [];
  let previous = new Uint8Array();
  for (
    let counter = 1;
    output.flatMap((part) => [...part]).length < length;
    counter += 1
  ) {
    previous = await hmac(
      prk,
      concatBytes(previous, info, new Uint8Array([counter])),
    );
    output.push(previous);
  }
  return concatBytes(...output).slice(0, length);
}

async function encryptPayload(
  subscription: Pick<PushSubscriptionRecord, "p256dh" | "auth">,
  payload: string,
) {
  const clientPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  const ephemeral = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const serverPublic = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );
  const clientKey = await crypto.subtle.importKey(
    "raw",
    clientPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientKey },
      ephemeral.privateKey,
      256,
    ),
  );
  const authPrk = await hmac(authSecret, sharedSecret);
  const ikmInfo = concatBytes(
    encoder.encode("WebPush: info\0"),
    clientPublic,
    serverPublic,
  );
  const ikm = await hkdfExpand(authPrk, ikmInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentPrk = await hmac(salt, ikm);
  const cek = await hkdfExpand(
    contentPrk,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdfExpand(
    contentPrk,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const plaintext = concatBytes(encoder.encode(payload), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return {
    body: concatBytes(
      salt,
      recordSize,
      new Uint8Array([serverPublic.byteLength]),
      serverPublic,
      ciphertext,
    ),
    dh: base64UrlEncode(serverPublic),
  };
}

function jsonWebToken(
  privateJwk: JsonWebKey,
  audience: string,
  subject: string,
) {
  return (async () => {
    const header = base64UrlEncode(
      encoder.encode(JSON.stringify({ alg: "ES256", typ: "JWT" })),
    );
    const payload = base64UrlEncode(
      encoder.encode(
        JSON.stringify({
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
          sub: subject,
        }),
      ),
    );
    const signingInput = encoder.encode(`${header}.${payload}`);
    const key = await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signingInput,
    );
    return `${header}.${payload}.${base64UrlEncode(signature)}`;
  })();
}

function preferenceColumn(type: NotificationPushRow["type"]) {
  if (type === "reply") return "push_replies";
  if (type === "mention") return "push_mentions";
  if (type === "like") return "push_likes";
  if (type === "follow") return "push_follows";
  return "push_thread_replies";
}

function notificationTarget(row: NotificationPushRow) {
  if (row.threadId)
    return `/threads/${row.threadId}${row.postId ? `#post-${row.postId}` : ""}`;
  return "/notifications";
}

async function sendWebPush(
  environment: PushEnvironment,
  subscription: PushSubscriptionRecord,
  row: NotificationPushRow,
) {
  const publicKey = environment.VAPID_PUBLIC_KEY?.trim();
  const privateJwkRaw = environment.VAPID_PRIVATE_JWK?.trim();
  if (!publicKey || !privateJwkRaw) throw new Error("VAPID is not configured.");
  const endpoint = new URL(subscription.endpoint);
  if (endpoint.protocol !== "https:")
    throw new Error("Push endpoint must use HTTPS.");
  const privateJwk = JSON.parse(privateJwkRaw) as JsonWebKey;
  const encrypted = await encryptPayload(
    subscription,
    JSON.stringify({
      title: "CFBBS 新通知",
      body: `${row.actorName || "有人"}${row.type === "like" ? "赞了你的帖子" : "有新的互动"}`,
      url: notificationTarget(row),
      notificationId: row.notificationId,
    }),
  );
  const audience = endpoint.origin;
  const token = await jsonWebToken(
    privateJwk,
    audience,
    environment.VAPID_SUBJECT?.trim() || "mailto:admin@example.invalid",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${token}, k=${publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "60",
      urgency: "normal",
    },
    body: encrypted.body,
  });
  return response;
}

export async function enqueueNotificationPush(
  database: D1Database,
  notificationId: string,
) {
  await database
    .prepare(
      "INSERT OR IGNORE INTO notification_push_outbox (id, notification_id, state, attempts, next_attempt_at, last_error, created_at, sent_at) VALUES (?, ?, 'pending', 0, ?, NULL, ?, NULL)",
    )
    .bind(
      crypto.randomUUID(),
      notificationId,
      new Date().toISOString(),
      new Date().toISOString(),
    )
    .run();
}

export async function processNotificationPushOutbox(
  environment: PushEnvironment,
) {
  if (
    !environment.VAPID_PUBLIC_KEY?.trim() ||
    !environment.VAPID_PRIVATE_JWK?.trim()
  ) {
    return 0;
  }
  const now = new Date().toISOString();
  const pending = await environment.DB.prepare(
    `SELECT notification_push_outbox.id AS outboxId,
              notification_push_outbox.notification_id AS notificationId,
              notifications.type, notifications.recipient_user_id AS recipientUserId,
              COALESCE(profiles.display_name, profiles.handle, federation_actors.name) AS actorName,
              notifications.thread_id AS threadId, notifications.post_id AS postId
       FROM notification_push_outbox
       INNER JOIN notifications ON notifications.id = notification_push_outbox.notification_id
       LEFT JOIN profiles ON profiles.user_id = notifications.actor_id
       LEFT JOIN federation_actors ON federation_actors.id = notifications.actor_id
       WHERE notification_push_outbox.state = 'pending'
         AND notification_push_outbox.next_attempt_at <= ?
       ORDER BY notification_push_outbox.created_at ASC
       LIMIT 25`,
  )
    .bind(now)
    .all<NotificationPushRow>();
  let processed = 0;
  for (const row of pending.results) {
    const preference = preferenceColumn(row.type);
    const enabled = await environment.DB.prepare(
      `SELECT COALESCE(${preference}, 1) AS enabled FROM user_notification_preferences WHERE user_id = ? LIMIT 1`,
    )
      .bind(row.recipientUserId)
      .first<{ enabled: number }>();
    const subscriptions =
      enabled?.enabled === 0
        ? { results: [] as PushSubscriptionRecord[] }
        : await environment.DB.prepare(
            "SELECT id, user_id AS userId, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
          )
            .bind(row.recipientUserId)
            .all<PushSubscriptionRecord>();
    if (subscriptions.results.length === 0) {
      await environment.DB.prepare(
        "UPDATE notification_push_outbox SET state = 'sent', sent_at = ? WHERE id = ?",
      )
        .bind(now, row.outboxId)
        .run();
      processed += 1;
      continue;
    }
    for (const subscription of subscriptions.results) {
      await environment.DB.prepare(
        "INSERT OR IGNORE INTO notification_push_deliveries (id, notification_id, subscription_id, state, attempts, next_attempt_at, last_error, created_at, sent_at) VALUES (?, ?, ?, 'pending', 0, ?, NULL, ?, NULL)",
      )
        .bind(
          crypto.randomUUID(),
          row.notificationId,
          subscription.id,
          now,
          now,
        )
        .run();
    }
    const deliveries = await environment.DB.prepare(
      `SELECT notification_push_deliveries.id AS deliveryId,
                push_subscriptions.id, push_subscriptions.user_id AS userId,
                push_subscriptions.endpoint, push_subscriptions.p256dh, push_subscriptions.auth
         FROM notification_push_deliveries
         INNER JOIN push_subscriptions ON push_subscriptions.id = notification_push_deliveries.subscription_id
         WHERE notification_push_deliveries.notification_id = ?
           AND notification_push_deliveries.state = 'pending'
           AND notification_push_deliveries.next_attempt_at <= ?`,
    )
      .bind(row.notificationId, now)
      .all<PushDeliveryRecord>();
    for (const delivery of deliveries.results) {
      try {
        const response = await sendWebPush(environment, delivery, row);
        if (response.status === 404 || response.status === 410) {
          await environment.DB.prepare(
            "DELETE FROM push_subscriptions WHERE id = ?",
          )
            .bind(delivery.id)
            .run();
        } else if (!response.ok) {
          throw new Error(`push HTTP ${response.status}`);
        }
        await environment.DB.prepare(
          "UPDATE notification_push_deliveries SET state = 'sent', sent_at = ?, last_error = NULL WHERE id = ?",
        )
          .bind(now, delivery.deliveryId)
          .run();
      } catch {
        await environment.DB.prepare(
          "UPDATE notification_push_deliveries SET attempts = attempts + 1, state = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END, next_attempt_at = ?, last_error = ? WHERE id = ?",
        )
          .bind(
            new Date(Date.now() + 60_000).toISOString(),
            "push delivery failed",
            delivery.deliveryId,
          )
          .run();
      }
    }
    const remaining = await environment.DB.prepare(
      "SELECT COUNT(*) AS total FROM notification_push_deliveries WHERE notification_id = ? AND state = 'pending'",
    )
      .bind(row.notificationId)
      .first<{ total: number }>();
    if (Number(remaining?.total ?? 0) > 0) {
      await environment.DB.prepare(
        "UPDATE notification_push_outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?",
      )
        .bind(
          new Date(Date.now() + 60_000).toISOString(),
          "push delivery failed",
          row.outboxId,
        )
        .run();
    } else {
      await environment.DB.prepare(
        "UPDATE notification_push_outbox SET state = 'sent', sent_at = ?, last_error = NULL WHERE id = ?",
      )
        .bind(now, row.outboxId)
        .run();
    }
    processed += 1;
  }
  return processed;
}
