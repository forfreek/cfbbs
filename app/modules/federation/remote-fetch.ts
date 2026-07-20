import type { DocumentLoader, RemoteDocument } from "@fedify/vocab";

import { isSafeRemoteUrl } from "./remote-url";

export const remoteDocumentFetchTimeoutMs = 8_000;
export const remoteDocumentMaxBytes = 1_000_000;
export const remoteDocumentMaxRedirects = 3;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type BoundedRemoteJsonDocument = {
  document: unknown;
  documentUrl: string;
};

type BoundedRemoteJsonFetchOptions = { signal?: AbortSignal };

function isRedirect(response: Response) {
  return [301, 302, 303, 307, 308].includes(response.status);
}

export function isActivityStreamsContentType(value: string | null) {
  if (!value) return false;
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return type === "application/activity+json" || type === "application/ld+json";
}

export function isJrdContentType(value: string | null) {
  if (!value) return false;
  return (
    value.split(";", 1)[0]?.trim().toLowerCase() === "application/jrd+json"
  );
}

function requestSignal(signal: AbortSignal | undefined) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, remoteDocumentFetchTimeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

async function parseBoundedJson(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > remoteDocumentMaxBytes
  ) {
    throw new Error("Remote document exceeds the allowed response size.");
  }
  if (!response.body) throw new Error("Remote document has no response body.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > remoteDocumentMaxBytes) {
        throw new Error("Remote document exceeds the allowed response size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Remote document must contain valid JSON.");
  }
}

export function createBoundedRemoteJsonFetcher(
  accept: string,
  acceptsContentType: (value: string | null) => boolean,
  fetcher: Fetcher = fetch,
): (
  value: string | URL,
  options?: BoundedRemoteJsonFetchOptions,
) => Promise<BoundedRemoteJsonDocument> {
  return async (value, options) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Remote document URL is invalid.");
    }

    for (
      let redirects = 0;
      redirects <= remoteDocumentMaxRedirects;
      redirects += 1
    ) {
      if (!isSafeRemoteUrl(url.href)) {
        throw new Error("Remote document URL must be a public HTTPS URL.");
      }
      const request = requestSignal(options?.signal);
      try {
        const response = await fetcher(url, {
          headers: {
            accept,
          },
          redirect: "manual",
          signal: request.signal,
        });
        if (isRedirect(response)) {
          const location = response.headers.get("location");
          if (!location)
            throw new Error("Remote document redirect has no location.");
          if (redirects === remoteDocumentMaxRedirects) {
            throw new Error("Remote document exceeded the redirect limit.");
          }
          url = new URL(location, url);
          continue;
        }
        if (!response.ok) {
          throw new Error(`Remote document returned HTTP ${response.status}.`);
        }
        if (!acceptsContentType(response.headers.get("content-type"))) {
          throw new Error("Remote document has an unsupported content type.");
        }
        const document = await parseBoundedJson(response);
        return { document, documentUrl: url.href };
      } catch (error) {
        if (request.signal.aborted) {
          throw new Error("Remote document fetch timed out or was cancelled.", {
            cause: error,
          });
        }
        throw error;
      } finally {
        request.cleanup();
      }
    }
    throw new Error("Remote document exceeded the redirect limit.");
  };
}

export function createBoundedRemoteDocumentLoader(
  fetcher: Fetcher = fetch,
): DocumentLoader {
  const fetchJson = createBoundedRemoteJsonFetcher(
    'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    isActivityStreamsContentType,
    fetcher,
  );
  return async (value, options) => {
    const document = await fetchJson(value, { signal: options?.signal });
    const remoteDocument: RemoteDocument = {
      contextUrl: null,
      ...document,
    };
    return remoteDocument;
  };
}
