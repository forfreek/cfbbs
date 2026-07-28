export type S3MediaConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export type MediaBlobStore = {
  put(
    key: string,
    bytes: ArrayBuffer,
    options?: {
      contentType?: string;
      contentDisposition?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
};

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeS3Key(key: string) {
  return key
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function sha256Hex(data: ArrayBuffer | string) {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

async function hmac(
  key: ArrayBuffer | Uint8Array | string,
  data: string,
): Promise<ArrayBuffer> {
  const keyBytes: Uint8Array =
    typeof key === "string"
      ? new TextEncoder().encode(key)
      : key instanceof Uint8Array
        ? key
        : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
}

async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
) {
  const kDate = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function normalizeEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("S3 endpoint must be http(s).");
  }
  return url;
}

export function parseS3MediaConfig(
  env: Record<string, string | undefined> | Env,
): S3MediaConfig | null {
  const endpoint = env.S3_ENDPOINT?.trim();
  const bucket = env.S3_BUCKET?.trim();
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  const region = env.S3_REGION?.trim() || "auto";
  const forcePathStyle =
    (env.S3_FORCE_PATH_STYLE ?? "true").trim().toLowerCase() !== "false";
  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  };
}

function objectUrl(config: S3MediaConfig, key: string) {
  const endpoint = normalizeEndpoint(config.endpoint);
  const encodedKey = encodeS3Key(key);
  if (config.forcePathStyle) {
    const base = endpoint.toString().replace(/\/$/, "");
    return new URL(`${base}/${encodeRfc3986(config.bucket)}/${encodedKey}`);
  }
  // virtual-hosted-style: https://bucket.endpoint/key
  const host = `${config.bucket}.${endpoint.host}`;
  return new URL(`${endpoint.protocol}//${host}/${encodedKey}`);
}

async function signedFetch(
  config: S3MediaConfig,
  input: {
    method: "GET" | "PUT" | "DELETE" | "HEAD";
    key: string;
    body?: ArrayBuffer | null;
    headers?: Record<string, string>;
  },
) {
  const url = objectUrl(config, input.key);
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const service = "s3";
  const payloadHash = await sha256Hex(input.body ?? new ArrayBuffer(0));

  const headers = new Headers(input.headers ?? {});
  headers.set("host", url.host);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("x-amz-date", amzDate);
  if (input.body && !headers.has("content-length")) {
    headers.set("content-length", String(input.body.byteLength));
  }

  const signedHeaderNames = [...headers.keys()]
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers.get(name)!.trim().replace(/\s+/g, " ")}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalQuery = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await deriveSigningKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
    service,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );

  return fetch(url.toString(), {
    method: input.method,
    headers,
    body: input.body ?? undefined,
  });
}

export function createS3MediaStore(config: S3MediaConfig): MediaBlobStore {
  return {
    async put(key, bytes, options) {
      const headers: Record<string, string> = {};
      if (options?.contentType) headers["content-type"] = options.contentType;
      if (options?.contentDisposition) {
        headers["content-disposition"] = options.contentDisposition;
      }
      if (options?.metadata) {
        for (const [name, value] of Object.entries(options.metadata)) {
          headers[`x-amz-meta-${name.toLowerCase()}`] = value;
        }
      }
      const response = await signedFetch(config, {
        method: "PUT",
        key,
        body: bytes,
        headers,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(
          `S3 PutObject failed (${response.status}): ${detail || response.statusText}`,
        );
      }
    },
    async get(key) {
      const response = await signedFetch(config, {
        method: "GET",
        key,
        body: null,
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(
          `S3 GetObject failed (${response.status}): ${detail || response.statusText}`,
        );
      }
      return response.arrayBuffer();
    },
    async delete(key) {
      const response = await signedFetch(config, {
        method: "DELETE",
        key,
        body: null,
      });
      // S3 delete is idempotent; treat 404 as success.
      if (response.status === 404) return;
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(
          `S3 DeleteObject failed (${response.status}): ${detail || response.statusText}`,
        );
      }
    },
  };
}

export function createMediaStoreFromEnv(env: Env): MediaBlobStore | null {
  const config = parseS3MediaConfig(env);
  if (!config) return null;
  return createS3MediaStore(config);
}
