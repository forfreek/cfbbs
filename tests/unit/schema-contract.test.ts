import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

describe("database schema contract", () => {
  it("exports the tables required by the local and federated forum domains", () => {
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        "authUsers",
        "authSessions",
        "authAccounts",
        "authVerifications",
        "profiles",
        "boards",
        "boardClosure",
        "groups",
        "groupPermissions",
        "threads",
        "posts",
        "postRevisions",
        "federationActors",
        "federationOutboxEvents",
        "mediaObjects",
        "postAttachments",
        "remoteObjectAttachments",
      ]),
    );
  });
});
