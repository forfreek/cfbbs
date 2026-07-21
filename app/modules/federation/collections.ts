import { createNoteActivity } from "./outbox";
import type { PublicPost } from "./note";

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
