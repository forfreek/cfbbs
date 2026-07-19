export function notificationPreview(input: {
  authorized: boolean;
  boardTitle: string;
  author: string;
  excerpt: string;
}) {
  return input.authorized
    ? {
        boardTitle: input.boardTitle,
        author: input.author,
        excerpt: input.excerpt,
      }
    : { boardTitle: null, author: null, excerpt: null };
}
