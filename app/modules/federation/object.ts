import { noteObject } from "./note";
import { validateHandle } from "@/modules/identity/handle";

export type PublicNotePost = {
  id: string;
  authorHandle: string;
  html: string;
  publishedAt: string;
  updatedAt: string;
  parentPostId: string | null;
};

const publicNoteQuery = `
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
  WHERE posts.id = ?
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

export async function loadPublicNote(
  database: D1Database,
  postId: string,
): Promise<PublicNotePost | null> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(postId)) return null;

  return database.prepare(publicNoteQuery).bind(postId).first<PublicNotePost>();
}

export function acceptsActivityStreams(accept: string) {
  return (
    accept.includes("application/activity+json") ||
    accept.includes("application/ld+json")
  );
}

export function isPublicNotePost(value: PublicNotePost) {
  return validateHandle(value.authorHandle).ok;
}

export const publicNoteQueries = { publicNoteQuery };

export function publicNoteActivityResponse(
  origin: string,
  post: PublicNotePost,
) {
  return new Response(JSON.stringify(noteObject(origin, post)), {
    headers: { "content-type": "application/activity+json" },
  });
}

// Serve Note documents from the Worker edge before Fedify/React Router content
// negotiation. Returning Response.json from the objects route loader still
// falls through document rendering for activity+json Accept headers.
export async function handlePublicNoteActivity(
  request: Request,
  database: D1Database,
  origin: string,
) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/objects\/([^/]+)$/);
  if (!match || !acceptsActivityStreams(request.headers.get("accept") ?? "")) {
    return null;
  }

  let postId: string;
  try {
    postId = decodeURIComponent(match[1]);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const post = await loadPublicNote(database, postId);
  if (!post || !isPublicNotePost(post)) {
    return new Response("Not found", { status: 404 });
  }
  return publicNoteActivityResponse(origin, post);
}
