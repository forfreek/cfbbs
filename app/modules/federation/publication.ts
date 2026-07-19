export function shouldFederatePost(input: {
  visibility: "public" | "private";
  state: "published" | "hidden" | "deleted";
  origin: "local" | "remote";
}) {
  return (
    input.visibility === "public" &&
    input.state === "published" &&
    input.origin === "local"
  );
}
