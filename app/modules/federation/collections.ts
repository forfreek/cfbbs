import { createNoteActivity } from "./outbox";
import type { PublicPost } from "./note";
import { validateHandle } from "@/modules/identity/handle";
import {
  loadPostAttachments,
  mediaRecordsToNoteAttachments,
} from "@/modules/media";

export type PublicActorPost = PublicPost;
export type ActorCollectionKind = "followers" | "following";
export type LocalActorCollectionOwner = {
  actorId: string;
  handle: string;
};

const publicActorPostQuery = `
  SELECT
    posts.id,
    profiles.handle AS authorHandle,
    posts.rendered_html AS html,
    posts.published_at AS publishedAt,
    posts.updated_at AS updatedAt,
    posts.parent_post_id AS parentPostId
  FROM posts
  INNER JOIN threads ON threads.id = posts.thread_id
  INNER JOIN boards ON boards.id = threads.board_id
  INNER JOIN profiles ON profiles.user_id = posts.author_user_id
  WHERE posts.author_user_id = ?
    AND posts.origin = 'local'
    AND posts.visibility = 'public'
    AND posts.state = 'published'
    AND boards.visibility = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM board_closure AS path
      INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id
      WHERE path.descendant_id = boards.id
        AND ancestor.visibility != 'public'
    )
  ORDER BY posts.published_at DESC, posts.id DESC
  LIMIT 20
`;

const publicActorPostCountQuery = `
  SELECT COUNT(*) AS total
  FROM posts
  INNER JOIN threads ON threads.id = posts.thread_id
  INNER JOIN boards ON boards.id = threads.board_id
  WHERE posts.author_user_id = ?
    AND posts.origin = 'local'
    AND posts.visibility = 'public'
    AND posts.state = 'published'
    AND boards.visibility = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM board_closure AS path
      INNER JOIN boards AS ancestor ON ancestor.id = path.ancestor_id
      WHERE path.descendant_id = boards.id
        AND ancestor.visibility != 'public'
    )
`;

function actorCollectionQueries(kind: ActorCollectionKind) {
  const targetColumn =
    kind === "followers" ? "following_actor_id" : "follower_actor_id";
  const itemColumn =
    kind === "followers" ? "follower_actor_id" : "following_actor_id";
  return {
    items: `
      SELECT federation_actors.uri
      FROM federation_follows
      INNER JOIN federation_actors ON federation_actors.id = federation_follows.${itemColumn}
      WHERE federation_follows.${targetColumn} = ?
        AND federation_follows.state = 'accepted'
      ORDER BY federation_follows.created_at DESC, federation_actors.uri ASC
      LIMIT 20
    `,
    count: `
      SELECT COUNT(*) AS total
      FROM federation_follows
      WHERE federation_follows.${targetColumn} = ?
        AND federation_follows.state = 'accepted'
    `,
  };
}

type Count = { total: number };
type ActorUri = { uri: string };

const localActorCollectionOwnerQuery = `
  SELECT federation_actors.id AS actorId, profiles.handle
  FROM profiles
  INNER JOIN federation_actors ON federation_actors.id = profiles.user_id
  WHERE profiles.handle = ?
    AND federation_actors.is_local = 1
  LIMIT 1
`;

export async function loadLocalActorCollectionOwner(
  database: D1Database,
  handle: string,
) {
  return database
    .prepare(localActorCollectionOwnerQuery)
    .bind(handle)
    .first<LocalActorCollectionOwner>();
}

export async function loadPublicActorOutbox(
  database: D1Database,
  userId: string,
) {
  const [posts, count] = await Promise.all([
    database.prepare(publicActorPostQuery).bind(userId).all<PublicActorPost>(),
    database.prepare(publicActorPostCountQuery).bind(userId).first<Count>(),
  ]);
  return { posts: posts.results, total: Number(count?.total ?? 0) };
}

export async function loadActorCollection(
  database: D1Database,
  actorId: string,
  kind: ActorCollectionKind,
) {
  const query = actorCollectionQueries(kind);
  const [actors, count] = await Promise.all([
    database.prepare(query.items).bind(actorId).all<ActorUri>(),
    database.prepare(query.count).bind(actorId).first<Count>(),
  ]);
  return {
    items: actors.results.map((actor) => actor.uri),
    total: Number(count?.total ?? 0),
  };
}

function collectionUrl(origin: string, handle: string, kind: string) {
  return new URL(`/users/${handle}/${kind}`, origin).href;
}

export function orderedCollection(
  origin: string,
  handle: string,
  kind: "outbox" | ActorCollectionKind,
  total: number,
) {
  const id = collectionUrl(origin, handle, kind);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: "OrderedCollection",
    totalItems: total,
    first: `${id}?page=true`,
  };
}

export function activityJsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/activity+json" },
  });
}

export async function handlePublicActorCollectionActivity(
  request: Request,
  database: D1Database,
  origin: string,
) {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/users\/([^/]+)\/(followers|following|outbox)$/,
  );
  const accept = request.headers.get("accept") ?? "";
  if (
    !match ||
    !(
      accept.includes("application/activity+json") ||
      accept.includes("application/ld+json")
    )
  ) {
    return null;
  }

  let rawHandle: string;
  try {
    rawHandle = decodeURIComponent(match[1]);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const handle = validateHandle(rawHandle);
  if (!handle.ok) return new Response("Not found", { status: 404 });

  const owner = await loadLocalActorCollectionOwner(database, handle.value);
  if (!owner) return new Response("Not found", { status: 404 });
  const page = url.searchParams.get("page") === "true";
  const kind = match[2] as "followers" | "following" | "outbox";

  if (kind === "outbox") {
    const outbox = await loadPublicActorOutbox(database, owner.actorId);
    if (!page) {
      return activityJsonResponse(
        orderedCollection(origin, owner.handle, "outbox", outbox.total),
      );
    }
    const posts = await attachOutboxMedia(database, origin, outbox.posts);
    return activityJsonResponse(outboxPage(origin, owner.handle, posts));
  }

  const collection = await loadActorCollection(database, owner.actorId, kind);
  return activityJsonResponse(
    page
      ? actorCollectionPage(origin, owner.handle, kind, collection.items)
      : orderedCollection(origin, owner.handle, kind, collection.total),
  );
}

async function attachOutboxMedia(
  database: D1Database,
  origin: string,
  posts: readonly PublicActorPost[],
) {
  const attachments = await loadPostAttachments(
    database,
    posts.map((post) => post.id),
  );
  return posts.map((post) => ({
    ...post,
    attachments: mediaRecordsToNoteAttachments(
      origin,
      attachments.get(post.id) ?? [],
    ),
  }));
}

export function outboxPage(
  origin: string,
  handle: string,
  posts: readonly PublicActorPost[],
) {
  const collection = collectionUrl(origin, handle, "outbox");
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${collection}?page=true`,
    type: "OrderedCollectionPage",
    partOf: collection,
    orderedItems: posts.map((post) => createNoteActivity(origin, post)),
  };
}

export function actorCollectionPage(
  origin: string,
  handle: string,
  kind: ActorCollectionKind,
  items: readonly string[],
) {
  const collection = collectionUrl(origin, handle, kind);
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${collection}?page=true`,
    type: "OrderedCollectionPage",
    partOf: collection,
    orderedItems: items,
  };
}

export const publicCollectionQueries = {
  publicActorPostQuery,
  publicActorPostCountQuery,
  actorCollectionQueries,
  localActorCollectionOwnerQuery,
};
