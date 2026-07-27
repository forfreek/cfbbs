import {
  createBoundedRemoteJsonFetcher,
  isActivityStreamsContentType,
  isJrdContentType,
} from "./remote-fetch";
import { isSafeRemoteUrl } from "./remote-url";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RemoteLookupTarget =
  | {
      kind: "handle";
      account: string;
      webFingerUrl: string;
    }
  | { kind: "url"; url: string };

export type RemoteLookupResult = {
  kind: "actor" | "object";
  name: string;
  type: string;
  url: string;
};

const completeHandle = /^@([a-z0-9._-]{1,64})@([^@/\s]+)$/i;
const actorTypes = new Set([
  "Application",
  "Group",
  "Organization",
  "Person",
  "Service",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, maximumLength = 200) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function activityTypes(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
}

function remoteLookupResult(document: unknown, documentUrl: string) {
  if (!isRecord(document)) {
    throw new Error("Remote ActivityPub document must be an object.");
  }

  const types = activityTypes(document.type);
  if (types.length === 0) {
    throw new Error("Remote ActivityPub document has no type.");
  }
  const id = stringValue(document.id, 2_000);
  const url = id && isSafeRemoteUrl(id) ? id : documentUrl;
  const type = types[0] ?? "ActivityPub resource";
  const name =
    stringValue(document.name) ??
    stringValue(document.preferredUsername) ??
    new URL(url).hostname;

  return {
    kind: types.some((candidate) => actorTypes.has(candidate))
      ? ("actor" as const)
      : ("object" as const),
    name,
    type,
    url,
  };
}

export function parseRemoteLookupTarget(
  value: string,
): RemoteLookupTarget | null {
  const query = value.normalize("NFKC").trim();
  if (isSafeRemoteUrl(query)) return { kind: "url", url: query };

  const match = completeHandle.exec(query);
  if (!match) return null;

  try {
    const origin = new URL(`https://${match[2]}`);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }
    const account = `${match[1]}@${origin.host}`;
    const webFingerUrl = new URL("/.well-known/webfinger", origin);
    webFingerUrl.searchParams.set("resource", `acct:${account}`);
    if (!isSafeRemoteUrl(webFingerUrl.href)) return null;
    return { kind: "handle", account, webFingerUrl: webFingerUrl.href };
  } catch {
    return null;
  }
}

async function actorUrlFromWebFinger(
  target: Extract<RemoteLookupTarget, { kind: "handle" }>,
  fetcher: Fetcher,
) {
  const fetchJrd = createBoundedRemoteJsonFetcher(
    "application/jrd+json",
    isJrdContentType,
    fetcher,
  );
  const { document } = await fetchJrd(target.webFingerUrl);
  if (
    !isRecord(document) ||
    typeof document.subject !== "string" ||
    document.subject.toLowerCase() !== `acct:${target.account}`.toLowerCase()
  ) {
    throw new Error(
      "Remote WebFinger subject does not match the requested handle.",
    );
  }
  if (!Array.isArray(document.links)) {
    throw new Error("Remote WebFinger document has no links.");
  }
  const self = document.links.find(
    (link) =>
      isRecord(link) &&
      link.rel === "self" &&
      typeof link.href === "string" &&
      isActivityStreamsContentType(
        typeof link.type === "string" ? link.type : null,
      ) &&
      isSafeRemoteUrl(link.href),
  );
  if (!isRecord(self) || typeof self.href !== "string") {
    throw new Error(
      "Remote WebFinger document has no safe ActivityPub self link.",
    );
  }
  return self.href;
}

export async function lookupRemoteResource(
  target: RemoteLookupTarget,
  fetcher: Fetcher = fetch,
): Promise<RemoteLookupResult> {
  const resourceUrl =
    target.kind === "handle"
      ? await actorUrlFromWebFinger(target, fetcher)
      : target.url;
  const fetchActivityDocument = createBoundedRemoteJsonFetcher(
    'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    isActivityStreamsContentType,
    fetcher,
  );
  const document = await fetchActivityDocument(resourceUrl);
  return remoteLookupResult(document.document, document.documentUrl);
}

export type ResolvedRemoteActor = {
  uri: string;
  inboxUrl: string;
  sharedInboxUrl: string | null;
  publicKeyPem: string;
  name: string;
};

function firstString(value: unknown, maximumLength = 2_000): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maximumLength) : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested: string | null = firstString(item, maximumLength);
      if (nested) return nested;
    }
  }
  if (isRecord(value) && "id" in value) {
    return firstString(value.id, maximumLength);
  }
  if (isRecord(value) && "href" in value) {
    return firstString(value.href, maximumLength);
  }
  return null;
}

function publicKeyPemFromActor(document: Record<string, unknown>) {
  const publicKey = document.publicKey;
  const candidates = Array.isArray(publicKey)
    ? publicKey
    : publicKey
      ? [publicKey]
      : [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const pem = firstString(candidate.publicKeyPem, 8_000);
    if (pem?.includes("BEGIN PUBLIC KEY")) return pem;
  }
  return null;
}

export function remoteActorFromDocument(
  document: unknown,
  documentUrl: string,
): ResolvedRemoteActor {
  if (!isRecord(document)) {
    throw new Error("Remote actor document must be an object.");
  }
  const types = activityTypes(document.type);
  if (!types.some((candidate) => actorTypes.has(candidate))) {
    throw new Error("Remote document is not an ActivityPub actor.");
  }
  const id = firstString(document.id, 2_000);
  const uri = id && isSafeRemoteUrl(id) ? id : documentUrl;
  if (!isSafeRemoteUrl(uri)) {
    throw new Error("Remote actor URI must be a public HTTPS URL.");
  }
  const inboxUrl = firstString(document.inbox, 2_000);
  if (!inboxUrl || !isSafeRemoteUrl(inboxUrl)) {
    throw new Error("Remote actor has no usable inbox.");
  }
  const endpoints = isRecord(document.endpoints) ? document.endpoints : null;
  const sharedInbox = endpoints
    ? firstString(endpoints.sharedInbox, 2_000)
    : null;
  if (sharedInbox !== null && !isSafeRemoteUrl(sharedInbox)) {
    throw new Error("Remote actor shared inbox must be a public HTTPS URL.");
  }
  const publicKeyPem = publicKeyPemFromActor(document);
  if (!publicKeyPem) {
    throw new Error("Remote actor has no usable public key.");
  }
  const name =
    stringValue(document.name) ??
    stringValue(document.preferredUsername) ??
    uri;
  return {
    uri,
    inboxUrl,
    sharedInboxUrl: sharedInbox,
    publicKeyPem,
    name,
  };
}

export async function resolveRemoteActorForFollow(
  target: RemoteLookupTarget,
  fetcher: Fetcher = fetch,
): Promise<ResolvedRemoteActor> {
  const resourceUrl =
    target.kind === "handle"
      ? await actorUrlFromWebFinger(target, fetcher)
      : target.url;
  const fetchActivityDocument = createBoundedRemoteJsonFetcher(
    'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
    isActivityStreamsContentType,
    fetcher,
  );
  const document = await fetchActivityDocument(resourceUrl);
  return remoteActorFromDocument(document.document, document.documentUrl);
}
