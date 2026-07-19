import { describe, expect, it } from "vitest";
import { actorId, noteId } from "@/modules/federation/identifiers";
describe("federation identifiers", () => {
  it("uses stable normalized public URLs", () => {
    expect(actorId("https://bbs.example.test", "Alice_42")).toBe(
      "https://bbs.example.test/users/alice_42",
    );
    expect(noteId("https://bbs.example.test", "post_1")).toBe(
      "https://bbs.example.test/objects/post_1",
    );
  });
  it("rejects invalid identifiers", () =>
    expect(() => noteId("https://bbs.example.test", "../secret")).toThrow(
      "Invalid post ID",
    ));
});
