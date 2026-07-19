import { describe, expect, it } from "vitest";
import {
  authorize,
  type PermissionGrant,
} from "@/modules/permissions/authorization";

const grants: PermissionGrant[] = [
  { groupId: "members", permission: "boards.view", boardId: null },
  { groupId: "writers", permission: "threads.create", boardId: "parent" },
  { groupId: "moderators", permission: "posts.delete_any", boardId: "child" },
];

describe("allow-only RBAC", () => {
  it("rejects guests and reports why", () =>
    expect(
      authorize({ userId: null, permission: "boards.view" }, [], grants),
    ).toEqual({ allowed: false, reason: "anonymous" }));
  it("unions permissions from all groups", () =>
    expect(
      authorize(
        { userId: "u", permission: "posts.delete_any", boardId: "child" },
        ["members", "moderators"],
        grants,
      ),
    ).toMatchObject({ allowed: true, reason: "granted" }));
  it("inherits a board-scoped grant from an ancestor", () =>
    expect(
      authorize(
        { userId: "u", permission: "threads.create", boardId: "child" },
        ["writers"],
        grants,
        ["parent"],
      ),
    ).toMatchObject({ allowed: true }));
  it("does not treat a child grant as permission on an ancestor", () =>
    expect(
      authorize(
        { userId: "u", permission: "posts.delete_any", boardId: "parent" },
        ["moderators"],
        grants,
      ),
    ).toEqual({ allowed: false, reason: "missing_grant" }));
});
