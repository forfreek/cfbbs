import { describe, expect, it } from "vitest";
import { nodeInfoDocument } from "@/modules/federation/nodeinfo";
describe("NodeInfo", () =>
  it("advertises ActivityPub", () =>
    expect(nodeInfoDocument("https://bbs.example.test")).toMatchObject({
      version: "2.1",
      protocols: ["activitypub"],
      metadata: { nodeName: "bbs.example.test" },
    })));
