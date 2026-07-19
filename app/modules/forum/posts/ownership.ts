export type MutablePostOwnership = {
  authorUserId: string | null;
  origin: "local" | "remote";
  state: "published" | "hidden" | "deleted";
};

export function canManageLocalPost(
  post: MutablePostOwnership,
  viewerUserId: string,
  hasModeratorPermission: boolean,
) {
  return (
    post.origin === "local" &&
    post.state === "published" &&
    post.authorUserId !== null &&
    (post.authorUserId === viewerUserId || hasModeratorPermission)
  );
}
